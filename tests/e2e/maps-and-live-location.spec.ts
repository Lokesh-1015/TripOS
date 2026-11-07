// Real maps, place search, Trip Replay's route and live location, through the real UI. The map's tile service and
// the place search are replaced, so these don't depend on outside services. Locations are made up by the browser.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const COVER = 'https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3';
const MUMBAI = { latitude: 18.922, longitude: 72.8347 };
const GATEWAY = { name: 'Gateway of India', address: 'Apollo Bandar, Mumbai, India', lat: 18.922, lng: 72.8347 };
// What Photon really answers with.
const PHOTON_GATEWAY = { geometry: { coordinates: [GATEWAY.lng, GATEWAY.lat] }, properties: { name: GATEWAY.name, street: 'Apollo Bandar', city: 'Mumbai', country: 'India' } };
const CORS = { 'access-control-allow-origin': '*' };
const stamp = Date.now().toString(36);
let counter = 0;

async function stubOutsideServices(context: BrowserContext) {
  await context.route('**/tiles.openfreemap.org/**', (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await context.route('**/photon.komoot.io/**', (route) => route.fulfill({ headers: CORS, json: { features: new URL(route.request().url()).searchParams.get('q')?.startsWith('Gateway') ? [PHOTON_GATEWAY, { properties: { name: 'Has no position' } }] : [] } }));
}

async function newUser(browser: Browser, name: string, options: { located?: boolean } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(options.located ? { geolocation: MUMBAI, permissions: ['geolocation'] } : {}),
  });
  await stubOutsideServices(context);
  const page = await context.newPage();
  await page.goto('/signup');
  await page.getByTestId('signup-name-input').fill(`${name} Tester`);
  await page.getByTestId('signup-email-input').fill(`map-${name.toLowerCase()}-${stamp}-${++counter}@example.test`);
  await page.getByTestId('signup-password-input').fill('correct-horse');
  await page.getByTestId('signup-submit-button').click();
  await page.getByTestId('onboarding-next-button').click();
  await page.getByTestId('onboarding-finish-button').click();
  await page.getByTestId('onboarding-friends-skip').click();
  await page.getByTestId('dashboard-welcome').waitFor();
  return { page, context };
}

const api = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([m, u, b]) => {
      const r = await fetch(`/api${u}`, { method: m as string, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [method, path, body] as const,
  );

async function createTrip(page: Page, over: Record<string, unknown> = {}) {
  const id = `trip-${stamp}-${++counter}`;
  const made = await api(page, 'POST', '/trips', { id, name: 'Map Trip', destination: 'Mumbai', cover: COVER, startDate: '2030-03-01', endDate: '2030-03-04', ...over });
  expect(made.status).toBe(201);
  return { id, joinCode: made.body.joinCode as string };
}

const openMap = async (page: Page, tripId: string) => {
  await page.goto(`/app/trips/${tripId}/map`);
  // The map library loads on first use, which takes a while on a dev server.
  await expect(page.getByTestId('trip-map')).toHaveAttribute('data-map-ready', 'true', { timeout: 30_000 });
};

test('places are found by search or a click, and saved with real coordinates', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'Places');
  const { id } = await createTrip(page);
  await openMap(page, id);
  await expect(page.getByTestId('illustrated-map')).toHaveCount(0);
  await test.step('the map fills its box, so every part of it can be clicked', async () => {
    const sizes = await page.evaluate(() => {
      const map = document.querySelector('[data-testid="trip-map"]')!.getBoundingClientRect();
      const canvas = document.querySelector('[data-testid="trip-map"] canvas')!.getBoundingClientRect();
      return { map: map.height, canvas: canvas.height };
    });
    expect(sizes.canvas).toBeGreaterThan(sizes.map - 5);
  });

  await test.step('searching fills in the name, address and position', async () => {
    await page.getByTestId('map-add-place-button').click();
    await page.getByTestId('place-search-input').fill('Gateway');
    await page.getByTestId('place-search-result').click();
    await expect(page.getByTestId('place-name-input')).toHaveValue('Gateway of India');
    await expect(page.getByTestId('place-address-input')).toHaveValue('Apollo Bandar, Mumbai, India');
    await page.getByTestId('place-save-button').click();
    await expect(page.getByTestId('map-places-list')).toContainText('Gateway of India');
  });

  await test.step('the place is on the map, and survives a reload with its coordinates', async () => {
    await expect(page.locator('[data-testid^="map-pin-"]')).toHaveCount(1);
    await openMap(page, id);
    await expect(page.locator('[data-testid^="map-pin-"]')).toHaveCount(1);
    const trip = (await api(page, 'GET', `/trips/${id}`)).body;
    expect(trip.places[0]).toMatchObject({ name: 'Gateway of India', lat: GATEWAY.lat, lng: GATEWAY.lng });
  });

  await test.step('clicking the map drops a pin at a real position', async () => {
    await page.getByTestId('map-add-place-button').click();
    await page.getByTestId('trip-map').click({ position: { x: 300, y: 300 } });
    await page.getByTestId('place-name-input').fill('Clicked spot');
    await page.getByTestId('place-save-button').click();
    await expect(page.locator('[data-testid^="map-pin-"]')).toHaveCount(2);
    // The pin shows straight away, so wait for the save to reach the server.
    await expect.poll(async () => {
      const trip = (await api(page, 'GET', `/trips/${id}`)).body;
      return typeof trip.places.find((p: { name: string }) => p.name === 'Clicked spot')?.lat;
    }).toBe('number');
  });

  await test.step('directions use the exact position', async () => {
    await page.locator('[data-testid^="map-place-"]', { hasText: 'Gateway of India' }).click();
    await expect(page.getByTestId('map-open-directions')).toHaveAttribute('href', /18\.922.*72\.8347/);
  });

  await context.close();
});

test('a place saved before real maps can be given a position', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'Older');
  const { id } = await createTrip(page);
  expect((await api(page, 'PUT', `/trips/${id}/places/pl-old-${stamp}`, { name: 'Old pin', type: 'stay', address: '', note: '' })).status).toBe(200);
  await openMap(page, id);
  await expect(page.getByTestId('map-places-list')).toContainText('Not on the map yet');
  await expect(page.locator('[data-testid^="map-pin-"]')).toHaveCount(0);
  await page.locator('[data-testid^="map-place-"]').click();
  await page.getByTestId('map-set-location').click();
  await page.getByTestId('place-search-input').fill('Gateway');
  await page.getByTestId('place-search-result').click();
  await expect(page.getByTestId('place-name-input')).toHaveValue('Old pin');
  await page.getByTestId('place-save-button').click();
  await expect(page.locator('[data-testid^="map-pin-"]')).toHaveCount(1);
  await expect(page.getByTestId('map-places-list')).not.toContainText('Not on the map yet');
  await context.close();
});

test('when search is down, the page says so and clicking the map still works', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'Down');
  const { id } = await createTrip(page);
  await context.route('**/photon.komoot.io/**', (route) => route.fulfill({ status: 503, headers: CORS, json: { message: 'down' } }));
  await openMap(page, id);
  await page.getByTestId('map-add-place-button').click();
  await page.getByTestId('place-search-input').fill('Anywhere');
  await expect(page.getByTestId('place-search-error')).toBeVisible();
  await page.getByTestId('trip-map').click({ position: { x: 300, y: 300 } });
  await expect(page.getByTestId('place-dialog')).toBeVisible();
  await context.close();
});

test('Trip Replay draws the real route between saved places, in order', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'Replay');
  const { id } = await createTrip(page, { startDate: '2024-03-01', endDate: '2024-03-04' });

  await page.goto(`/app/trips/${id}/replay`);
  await expect(page.getByTestId('replay-no-route')).toBeVisible();

  const stops = [['One', 18.92, 72.83], ['Two', 19.07, 72.87], ['Three', 18.52, 73.85]] as const;
  for (const [name, lat, lng] of stops) {
    expect((await api(page, 'PUT', `/trips/${id}/places/pl-${name}-${stamp}`, { name, type: 'destination', lat, lng, address: '', note: '' })).status).toBe(200);
  }
  await page.goto(`/app/trips/${id}/replay`);
  await expect(page.getByTestId('trip-map')).toHaveAttribute('data-map-ready', 'true', { timeout: 30_000 });
  const pins = page.locator('[data-testid^="map-pin-"]');
  await expect(pins).toHaveCount(3);
  await expect(page.getByTestId(`map-pin-pl-One-${stamp}`)).toContainText('1');
  await expect(page.getByTestId(`map-pin-pl-Three-${stamp}`)).toContainText('3');
  await context.close();
});

test('live location is opt-in, seen by the trip only, always visible to the sharer, and ends cleanly', async ({ browser }) => {
  const sharer = await newUser(browser, 'Sharer', { located: true });
  const member = await newUser(browser, 'Member');
  const outsider = await newUser(browser, 'Outsider');
  const { id, joinCode } = await createTrip(sharer.page);
  await api(member.page, 'POST', `/invites/${joinCode}/accept`);
  const sharerId = (await api(sharer.page, 'GET', '/state')).body.user.id;
  await openMap(sharer.page, id);
  await openMap(member.page, id);
  const banner = sharer.page.getByTestId(`live-location-banner-${id}`);

  await test.step('nothing is shared until someone chooses to', async () => {
    await expect(member.page.getByTestId('live-location-empty')).toBeVisible();
    await expect(banner).toHaveCount(0);
    expect((await api(member.page, 'GET', `/trips/${id}/live-locations`)).body).toEqual([]);
  });

  await test.step('starting explains what it does and asks how long', async () => {
    await sharer.page.getByTestId('live-location-start').click();
    await expect(sharer.page.getByTestId('live-location-dialog')).toContainText('no history');
    await expect(sharer.page.getByTestId('live-location-dialog')).toContainText('Only the people on Map Trip');
    await sharer.page.getByTestId('live-location-hours-4').click();
    await sharer.page.getByTestId('live-location-confirm').click();
  });

  await test.step('the sharer sees a banner on every page', async () => {
    await expect(banner).toContainText('Sharing your live location with Map Trip');
    await sharer.page.goto('/app/settings');
    await expect(banner).toBeVisible();
    await sharer.page.goto(`/app/trips/${id}/map`);
  });

  await test.step('the other member sees it live, with no reload', async () => {
    await expect(member.page.getByTestId(`live-pin-${sharerId}`)).toBeVisible();
    await expect(member.page.getByTestId(`live-location-person-${sharerId}`)).toContainText('Live now');
  });

  await test.step('finding them stays on this map, with nothing opened on another site', async () => {
    const popup = member.context.waitForEvent('page', { timeout: 1500 }).catch(() => null);
    await member.page.getByTestId(`live-location-person-${sharerId}`).click();
    expect(await popup).toBeNull();
  });

  await test.step('someone outside the trip can\'t see it', async () => {
    expect((await api(outsider.page, 'GET', `/trips/${id}/live-locations`)).status).toBe(403);
  });

  await test.step('positions stay out of the trip data and the feed', async () => {
    const trip = JSON.stringify((await api(member.page, 'GET', `/trips/${id}`)).body);
    expect(trip).not.toContain(String(MUMBAI.longitude));
    await member.page.goto(`/app/trips/${id}`);
    await expect(member.page.getByTestId('trip-activity-feed')).toContainText('started sharing their live location for 4 hours');
    await openMap(member.page, id);
  });

  await test.step('stopping removes it for everyone, right away', async () => {
    await sharer.page.getByTestId('live-location-banner-stop').click();
    await expect(banner).toHaveCount(0);
    await expect(member.page.getByTestId(`live-pin-${sharerId}`)).toHaveCount(0);
    await expect(member.page.getByTestId('live-location-empty')).toBeVisible();
    expect((await api(member.page, 'GET', `/trips/${id}/live-locations`)).body).toEqual([]);
  });

  await test.step('signing out stops sharing', async () => {
    await sharer.page.getByTestId('live-location-start').click();
    await sharer.page.getByTestId('live-location-confirm').click();
    await expect(member.page.getByTestId(`live-pin-${sharerId}`)).toBeVisible();
    await sharer.page.getByTestId('sidebar-account-menu-button').click();
    await sharer.page.getByTestId('account-menu-sign-out').click();
    await expect(sharer.page).toHaveURL(/\/login/);
    await expect(member.page.getByTestId(`live-pin-${sharerId}`)).toHaveCount(0);
  });

  await sharer.context.close();
  await member.context.close();
  await outsider.context.close();
});

test('a browser that blocks location gets a clear message, and nothing is shared', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'Blocked');
  const { id } = await createTrip(page);
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, fail) => fail?.({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'denied' } as GeolocationPositionError);
  });
  await openMap(page, id);
  await page.getByTestId('live-location-start').click();
  await page.getByTestId('live-location-confirm').click();
  await expect(page.getByTestId('live-location-error')).toContainText('Location access is blocked');
  expect((await api(page, 'GET', `/trips/${id}/live-locations`)).body).toEqual([]);
  await context.close();
});

test('turning off location sharing in privacy settings stops it and hides the button', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'Private', { located: true });
  const { id } = await createTrip(page);
  await openMap(page, id);
  await page.getByTestId('live-location-start').click();
  await page.getByTestId('live-location-confirm').click();
  await expect(page.getByTestId(`live-location-banner-${id}`)).toBeVisible();
  const privacy = (await api(page, 'GET', '/state')).body.settings.privacy;
  expect((await api(page, 'PATCH', '/me', { privacy: { ...privacy, shareLocation: false } })).status).toBe(200);
  await openMap(page, id);
  await expect(page.getByTestId(`live-location-banner-${id}`)).toHaveCount(0);
  await expect(page.getByTestId('live-location-off')).toBeVisible();
  await expect(page.getByTestId('live-location-start')).toHaveCount(0);
  await context.close();
});

test('positions aren\'t kept in the offline copy on the device', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'Copy', { located: true });
  const { id } = await createTrip(page);
  await openMap(page, id);
  await page.getByTestId('live-location-start').click();
  await page.getByTestId('live-location-confirm').click();
  await expect(page.getByTestId(`live-location-banner-${id}`)).toBeVisible();
  await page.waitForTimeout(1500);
  const copy = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open('tripos-offline', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('snapshots');
        open.onsuccess = () => {
          const get = open.result.transaction('snapshots').objectStore('snapshots').get('state');
          get.onsuccess = () => resolve(JSON.stringify(get.result ?? {}));
        };
      }),
  );
  expect(copy).not.toContain(String(MUMBAI.longitude));
  await context.close();
});

test('a browser with no WebGL gets a clear message, and places and search still work', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'NoWebgl');
  const { id } = await createTrip(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type.startsWith('webgl') ? null : (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await page.goto(`/app/trips/${id}/map`);
  await expect(page.getByTestId('trip-map-unsupported')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('map-add-place-button').click();
  await page.getByTestId('place-search-input').fill('Gateway');
  await page.getByTestId('place-search-result').click();
  await page.getByTestId('place-save-button').click();
  await expect(page.getByTestId('map-places-list')).toContainText('Gateway of India');
  await context.close();
});
