import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const TEST_TOKEN_PREFIX = "test-google.";

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string;
}

/** Checks the signed token Google gives the browser. There's no client secret, as this needs only Google's public keys. */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  readonly clientId: string | undefined;
  private readonly acceptTestTokens: boolean;
  keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(GOOGLE_KEYS_URL));

  constructor(config: ConfigService) {
    this.clientId = config.get<string>("GOOGLE_CLIENT_ID") || undefined;
    // Browser tests can't sign in to Google. This can't be turned on in production.
    this.acceptTestTokens = config.get<string>("NODE_ENV") !== "production" && config.get<string>("GOOGLE_TEST_TOKENS") === "true";
  }

  get enabled() {
    return !!this.clientId || this.acceptTestTokens;
  }

  async verify(credential: string): Promise<GoogleIdentity> {
    if (this.acceptTestTokens && credential.startsWith(TEST_TOKEN_PREFIX)) {
      return this.toIdentity(JSON.parse(Buffer.from(credential.slice(TEST_TOKEN_PREFIX.length), "base64url").toString()) as Record<string, unknown>);
    }
    if (!this.clientId) throw new ServiceUnavailableException({ message: "Sign in with Google isn't available right now" });
    try {
      const { payload } = await jwtVerify(credential, this.keys, { issuer: GOOGLE_ISSUERS, audience: this.clientId });
      return this.toIdentity(payload);
    } catch (err) {
      // A token that's wrong is refused. Not being able to reach Google is a different problem, and is reported as one.
      if (err instanceof errors.JOSEError && !(err instanceof errors.JWKSTimeout)) throw new UnauthorizedException({ message: "Google sign-in didn't work. Please try again." });
      this.logger.error(`Could not check a Google sign-in: ${err instanceof Error ? err.message : String(err)}`);
      throw new ServiceUnavailableException({ message: "Sign in with Google isn't available right now" });
    }
  }

  private toIdentity(claims: Record<string, unknown>): GoogleIdentity {
    if (typeof claims.sub !== "string" || typeof claims.email !== "string") throw new UnauthorizedException({ message: "Google sign-in didn't work. Please try again." });
    return {
      sub: claims.sub,
      email: claims.email,
      // Only Google's word that it's confirmed this address may link it to an account.
      emailVerified: claims.email_verified === true || claims.email_verified === "true",
      name: typeof claims.name === "string" ? claims.name : "",
      picture: typeof claims.picture === "string" ? claims.picture : "",
    };
  }
}
