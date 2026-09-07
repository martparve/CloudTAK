import { describe, expect, it } from 'vitest';
import { buildMgrsGrid, gridIntervalForZoom, zoneLongitudeBand, latLngToUTMInZone } from './mgrsGrid.ts';
import { latLngToUTM } from './coordinateFormat.ts';

describe('mgrsGrid', () => {
    // Rummu, Estonia: UTM zone 35V
    const estonia: [number, number, number, number] = [24.1, 59.1, 24.9, 59.5];

    it('picks coarser intervals when zoomed out', () => {
        expect(gridIntervalForZoom(6)).toBe(100000);
        expect(gridIntervalForZoom(10)).toBe(10000);
        expect(gridIntervalForZoom(14)).toBe(1000);
    });

    it('computes zone longitude bands', () => {
        expect(zoneLongitudeBand(35)).toEqual([24, 30]);
        expect(zoneLongitudeBand(1)).toEqual([-180, -174]);
    });

    it('matches the zone-selecting projection when the zone is the natural one', () => {
        const natural = latLngToUTM(59.3, 25.0);
        const forced = latLngToUTMInZone(59.3, 25.0, natural.zoneNum, natural.zoneLetter);
        expect(forced.easting).toBeCloseTo(natural.easting, 3);
        expect(forced.northing).toBeCloseTo(natural.northing, 3);
    });

    it('builds 10 km lines and labels for a regional view', () => {
        const grid = buildMgrsGrid(estonia, 11);
        const lines = grid.features.filter((f) => f.properties.kind === 'line');
        const squares = grid.features.filter((f) => f.properties.kind === 'label' && f.properties.role === 'square');
        const values = grid.features.filter((f) => f.properties.kind === 'label' && f.properties.role === 'value');

        expect(lines.length).toBeGreaterThan(10);
        expect(values.length).toBeGreaterThan(0);
        expect(squares.some((f) => (f.properties as { text: string }).text.startsWith('35V '))).toBe(true);

        // Every line vertex should be inside zone 35's longitude band.
        for (const line of lines) {
            for (const [lng] of (line.geometry as GeoJSON.LineString).coordinates) {
                expect(lng).toBeGreaterThanOrEqual(24 - 1e-6);
                expect(lng).toBeLessThanOrEqual(30 + 1e-6);
            }
        }
    });

    it('spans two zones when the view crosses a zone boundary', () => {
        const grid = buildMgrsGrid([23.5, 59.1, 24.5, 59.5], 11);
        const squares = grid.features.filter((f) => f.properties.kind === 'label' && f.properties.role === 'square')
            .map((f) => (f.properties as { text: string }).text);
        expect(squares.some((t) => t.startsWith('34V'))).toBe(true);
        expect(squares.some((t) => t.startsWith('35V'))).toBe(true);
    });

    it('returns nothing when zoomed out across many zones', () => {
        expect(buildMgrsGrid([-30, 40, 40, 70], 4).features).toHaveLength(0);
    });

    it('returns nothing outside the UTM latitude range', () => {
        expect(buildMgrsGrid([10, 85, 20, 89], 12).features).toHaveLength(0);
    });
});
