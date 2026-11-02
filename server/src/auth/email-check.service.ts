import { createRequire } from "node:module";
import { promises as dns } from "node:dns";
import { Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const require = createRequire(import.meta.url);

// Set aside for documentation and testing (RFC 2606, RFC 6761), so nobody can ever receive mail at them.
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org", "test.com"]);
const RESERVED_ENDINGS = [".test", ".example", ".invalid", ".localhost", ".local"];
const CACHE_MS = 60 * 60 * 1000;
const CACHE_SIZE = 1000;
const LOOKUP_TIMEOUT_MS = 4_000;
// Asked directly, because a machine's own DNS settings can refuse these queries or make up answers for unknown names.
const DNS_SERVERS = ["1.1.1.1", "8.8.8.8"];

type Lookup = { mx: (domain: string) => Promise<{ exchange: string }[]>; address: (domain: string) => Promise<unknown> };

const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

/**
 * Turns away addresses that can't be real before anything is sent. It can't prove a mailbox exists: only the
 * confirmation email does that. A failed lookup lets the address through, so a DNS problem never stops a signup.
 */
@Injectable()
export class EmailCheckService {
  private readonly logger = new Logger(EmailCheckService.name);
  private readonly skip: Set<string>;
  private readonly cache = new Map<string, { at: number; deliverable: boolean }>();
  private disposable: Set<string> | null = null;
  lookup: Lookup;

  constructor(config: ConfigService) {
    const resolver = new dns.Resolver({ timeout: 2_000, tries: 1 });
    resolver.setServers(DNS_SERVERS);
    this.lookup = { mx: (domain) => resolver.resolveMx(domain), address: (domain) => resolver.resolve4(domain) };
    // Test suites sign up thousands of made-up addresses. This never applies in production.
    const domains = config.get<string>("NODE_ENV") === "production" ? "" : config.get<string>("EMAIL_CHECK_SKIP_DOMAINS", "");
    this.skip = new Set(domains.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean));
  }

  /** An address these checks don't apply to, which also isn't asked to confirm itself. Only in tests. */
  isExempt(email: string) {
    return this.skip.has(this.domainOf(email));
  }

  async assertReal(email: string) {
    const domain = this.domainOf(email);
    if (this.skip.has(domain)) return;
    if (RESERVED_DOMAINS.has(domain) || RESERVED_ENDINGS.some((ending) => domain.endsWith(ending)) || !domain.includes(".")) {
      throw new UnprocessableEntityException({ message: "That doesn't look like a real email address. Please use one you can receive mail at." });
    }
    if (this.isDisposable(domain)) {
      throw new UnprocessableEntityException({ message: "Temporary email addresses aren't accepted. Please use your regular email address." });
    }
    if (!(await this.canReceiveMail(domain))) {
      throw new UnprocessableEntityException({ message: `We can't deliver email to ${domain}. Please check the address for typos.` });
    }
  }

  private domainOf(email: string) {
    return email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase();
  }

  private isDisposable(domain: string) {
    // Over 100,000 domains, so it's only loaded once someone first signs up.
    this.disposable ??= new Set(require("disposable-email-domains") as string[]);
    const parts = domain.split(".");
    return parts.some((_, i) => i < parts.length - 1 && (this.disposable as Set<string>).has(parts.slice(i).join(".")));
  }

  private async canReceiveMail(domain: string) {
    const cached = this.cache.get(domain);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.deliverable;
    const deliverable = await this.lookUp(domain);
    if (deliverable === null) return true;
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(domain, { at: Date.now(), deliverable });
    return deliverable;
  }

  /** True or false when DNS gives an answer, null when it doesn't. */
  private async lookUp(domain: string): Promise<boolean | null> {
    try {
      const records = await this.withTimeout(this.lookup.mx(domain));
      // A single empty record is a domain saying outright that it takes no email (RFC 7505).
      return !records.every((record) => record.exchange === "" || record.exchange === ".") && records.length > 0;
    } catch (err) {
      if (!NOT_FOUND.has((err as NodeJS.ErrnoException).code ?? "")) {
        this.logger.warn(`Couldn't check ${domain}: ${(err as Error).message}`);
        return null;
      }
    }
    // With no mail records, mail goes to the domain itself if it has an address.
    try {
      await this.withTimeout(this.lookup.address(domain));
      return true;
    } catch (err) {
      return NOT_FOUND.has((err as NodeJS.ErrnoException).code ?? "") ? false : null;
    }
  }

  private withTimeout<T>(request: Promise<T>) {
    return Promise.race([request, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), LOOKUP_TIMEOUT_MS).unref())]);
  }
}
