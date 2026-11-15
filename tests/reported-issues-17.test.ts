import { describe, expect, it } from 'vitest';
import { defaultGameOptions, newCampaignOptions } from '../src/app/newGame';
import { orderPeopleBySite, orderPersonAtSite } from '../src/app/orderSelection';
import { snitchPrice } from '../src/sim/api';
import { hoodPayDemand } from '../src/sim/citygen';
import { SURNAMES } from '../src/sim/data/names';
import { knownShopkeeper } from '../src/sim/mapIntel';
import { originalWageQuote, specialistAskingWage } from '../src/sim/originalWages';
import { siteBuilding } from '../src/sim/premises';
import { Sim } from '../src/sim/sim';
import { SKILLS, type Person } from '../src/sim/types';
import { allBuildings } from '../src/sim/world';

const compact = () => new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startMoney: 100_000 });
let originalCity: Sim | undefined;
/** The original 40 × 32 city is slow to lay out: one for the whole file, read only. */
const original = () => originalCity ??= new Sim({ ...newCampaignOptions(), seed: 4711 });

describe('issue 17 item 1: a headquarters block is one building', () => {
  it('resolves the terraces round a gang’s headquarters to its street front', () => {
    const w = original().world;
    let terraces = 0;
    for (const office of allBuildings(w).filter(b => b.isHQ)) {
      const front = w.buildings[office.frontId!];
      expect(front.hidesId).toBe(office.id);
      for (const lotId of w.blocks[office.blockId].lotIds) {
        const part = w.buildings[w.lots[lotId].buildingId];
        if (part?.cls !== 'residential') continue;
        expect(siteBuilding(w, part).id).toBe(front.id);
        terraces++;
      }
    }
    // The headquarters were made from apartment blocks: there are terraces to fold in.
    expect(terraces).toBeGreaterThan(0);
  });
});

describe('issue 17 items 15 and 23: whose name a site is given', () => {
  it('names a shopkeeper only at a place the gang knows, and never at one a gang has bought', () => {
    const sim = compact(), w = sim.world, g = sim.playerGang;
    const shop = allBuildings(w).find(b => b.cls === 'commercial' && b.ownerPersonId != null && b.ownerGangId == null && !(b.knowledge[g.id] >= 2))!;
    expect(knownShopkeeper(w, shop, g.id)).toBeNull();
    shop.knowledge[g.id] = 2;
    expect(knownShopkeeper(w, shop, g.id)?.id).toBe(shop.ownerPersonId);
    // Bought: the seller stays inside, but the owner is the gang.
    shop.ownerGangId = g.id; shop.knowledge[g.id] = 4;
    expect(knownShopkeeper(w, shop, g.id)).toBeNull();
  });
});

describe('issue 17 item 26: the seller of your own business is not its target', () => {
  it('does not offer the shopkeeper who sold you the place when it is clicked for a Kill', () => {
    const sim = compact(), w = sim.world, g = sim.playerGang;
    const shop = allBuildings(w).find(b => b.cls === 'commercial' && b.ownerPersonId != null && b.ownerGangId == null && b.managerId == null)!;
    const seller = shop.ownerPersonId!;
    shop.knowledge[g.id] = 2;
    expect(orderPersonAtSite(w, g.id, 'kill', shop)).toBe(seller);
    expect(orderPeopleBySite(w, g.id, 'kill').get(shop.id)).toBe(seller);
    shop.ownerGangId = g.id; shop.knowledge[g.id] = 4;
    expect(orderPersonAtSite(w, g.id, 'kill', shop)).not.toBe(seller);
    expect(orderPeopleBySite(w, g.id, 'kill').get(shop.id)).not.toBe(seller);
    // A rival's shopkeeper is still found through his shop.
    const other = allBuildings(w).find(b => b.id !== shop.id && b.cls === 'commercial' && b.ownerPersonId != null && b.ownerGangId == null)!;
    other.knowledge[g.id] = 2;
    expect(orderPersonAtSite(w, g.id, 'kill', other)).toBe(other.ownerPersonId);
  });
});

describe('issue 17 item 16: what an accountant or lawyer asks', () => {
  const specialist = (w: Sim['world'], role: 'accountant' | 'lawyer') =>
    Object.values(w.people).find(p => p.role === role && p.gangId == null && p.status === 'active')!;
  const withSkills = (p: Person, intelligence: number, rest: number): Person =>
    ({ ...p, skills: Object.fromEntries(SKILLS.map(k => [k, k === 'intelligence' ? intelligence : rest])) as Person['skills'] });

  it('prices a specialist by Intelligence, not by skills he is never hired for', () => {
    const p = specialist(compact().world, 'accountant');
    const sharp = hoodPayDemand(withSkills(p, 5, 1), 'accountant'), dull = hoodPayDemand(withSkills(p, 1, 5), 'accountant');
    expect(sharp).toBeGreaterThan(dull);
    // The other ten skills no longer move the price at all.
    expect(hoodPayDemand(withSkills(p, 3, 1), 'lawyer')).toBe(hoodPayDemand(withSkills(p, 3, 5), 'lawyer'));
    expect(hoodPayDemand(withSkills(p, 5, 3), 'accountant') - hoodPayDemand(withSkills(p, 1, 3), 'accountant')).toBeGreaterThanOrEqual(150);
  });

  it('lists the wage that will be paid: the demand in a compact city, the quote in the original one', () => {
    const small = compact(), p = specialist(small.world, 'lawyer');
    expect(specialistAskingWage(small.world, p, small.playerGang.id)).toBe(p.payDemand);
    const big = original(), q = specialist(big.world, 'accountant');
    expect(specialistAskingWage(big.world, q, big.playerGang.id)).toBe(originalWageQuote(q, big.playerGang.id));
  });
});

describe('issue 17 item 5.1: a snitch charges for the names he can sell', () => {
  it('asks no more for the unattached hoods than for the six names he will give', () => {
    const sim = original(), w = sim.world, g = sim.playerGang;
    const unknown = Object.values(w.people).filter(p => p.gangId == null && p.status !== 'dead' && !g.knownPeople.includes(p.id) &&
      (p.role === 'hood' || p.role === 'lieutenant')).length;
    expect(unknown).toBeGreaterThan(6);
    expect(snitchPrice(w, g.id, [0])).toBe(400 + 6 * 30);
    const rival = Object.values(w.gangs).find(o => o.id !== g.id)!;
    expect(snitchPrice(w, g.id, [0, rival.id])).toBe(800 + 6 * 30);
  });
});

describe('issue 17 item 29: nobody shares a name', () => {
  it('lists no surname twice', () => {
    expect(new Set(SURNAMES).size).toBe(SURNAMES.length);
  });

  it.each([['the original city', original], ['a compact city', compact]] as const)('gives every person in %s a name of their own', (_city, make) => {
    const names = Object.values(make().world.people).map(p => p.name);
    expect(names.length).toBeGreaterThan(100);
    expect(new Set(names).size).toBe(names.length);
  });
});
