import { expect, type Page, type APIRequestContext } from '@playwright/test';

export const USERNAME = process.env.E2E_USERNAME || '';
export const PASSWORD = process.env.E2E_PASSWORD || '';

export function requireCredentials(): void {
    if (!USERNAME || !PASSWORD) {
        throw new Error('Set E2E_USERNAME and E2E_PASSWORD to run the end-to-end tests');
    }
}

/** Log in through the UI and wait until the map has finished loading. */
export async function loginViaUi(page: Page): Promise<void> {
    requireCredentials();

    await page.goto('/login');
    await page.getByPlaceholder(/your@email\.com|username/i).first().fill(USERNAME);
    await page.getByPlaceholder('Your password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    await waitForMap(page);
}

/** Wait for the MapLibre canvas and for the store to report the map fully loaded. */
export async function waitForMap(page: Page): Promise<void> {
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 60_000 });
    await page.waitForFunction(() => {
        const map = (window as unknown as { cloudtakMap?: { loaded: () => boolean } }).cloudtakMap;
        return !!map && map.loaded();
    }, undefined, { timeout: 60_000 });
}

/** API token for direct calls (profile setup etc). */
export async function apiToken(request: APIRequestContext, baseURL: string): Promise<string> {
    requireCredentials();
    const res = await request.post(`${baseURL}/api/login`, {
        data: { username: USERNAME, password: PASSWORD },
    });
    expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
    const body = await res.json() as { token: string };
    return body.token;
}

/** Number of features currently loaded in a MapLibre source on the page. */
export async function sourceFeatureCount(page: Page, sourceId: string): Promise<number> {
    return page.evaluate((id) => {
        const map = (window as unknown as { cloudtakMap?: { querySourceFeatures: (s: string) => unknown[]; getSource: (s: string) => unknown } }).cloudtakMap;
        if (!map || !map.getSource(id)) return -1;
        return map.querySourceFeatures(id).length;
    }, sourceId);
}

/** Fly the map to a location/zoom and wait for it to settle. */
export async function flyTo(page: Page, center: [number, number], zoom: number): Promise<void> {
    await page.evaluate(([c, z]) => {
        const map = (window as unknown as { cloudtakMap?: { jumpTo: (o: unknown) => void } }).cloudtakMap;
        map?.jumpTo({ center: c, zoom: z });
    }, [center, zoom] as const);
    await page.waitForFunction(() => {
        const map = (window as unknown as { cloudtakMap?: { loaded: () => boolean; isMoving: () => boolean } }).cloudtakMap;
        return !!map && map.loaded() && !map.isMoving();
    }, undefined, { timeout: 30_000 });
}
