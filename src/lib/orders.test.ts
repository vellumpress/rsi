import { describe, expect, it } from "vitest";
import { fitBuy, fitSell } from "./orders";

describe("order invariants", () => {
  it("never spends more cash than the earmarked bucket plus dry powder", () => {
    const fit = fitBuy({
      desiredDollars: 5_000,
      price: 60,
      earmarked: 2_000,
      dry: 1_000,
      marketValue: 4_000,
      bookValue: 100_000,
      positionCap: 0.15,
      useEarmarked: true,
    });
    expect(fit.ok).toBe(true);
    expect(fit.fromEarmarked + fit.fromDry).toBeCloseTo(fit.dollars, 2);
    expect(fit.fromEarmarked).toBeLessThanOrEqual(2_000);
    expect(fit.fromDry).toBeLessThanOrEqual(1_000);
    expect(fit.dollars).toBeLessThanOrEqual(3_000);
  });

  it("never pushes a position through 15% of book", () => {
    const fit = fitBuy({
      desiredDollars: 8_000,
      price: 10,
      earmarked: 20_000,
      dry: 20_000,
      marketValue: 14_000,
      bookValue: 100_000,
      positionCap: 0.15,
      useEarmarked: true,
    });
    expect(fit.ok).toBe(true);
    expect(14_000 + fit.dollars).toBeLessThanOrEqual(15_000 + 0.01);
  });

  it("refuses a buy when the price is missing, zero, or negative", () => {
    for (const price of [null, 0, -4]) {
      const fit = fitBuy({
        desiredDollars: 1_000,
        price,
        earmarked: 5_000,
        dry: 5_000,
        marketValue: 1_000,
        bookValue: 100_000,
        positionCap: 0.15,
        useEarmarked: true,
      });
      expect(fit.ok).toBe(false);
      expect(fit.dollars).toBe(0);
      expect(fit.reason).toMatch(/Insufficient data, no action/);
    }
  });

  it("never sells more shares than are held, and a trim cannot be a full exit", () => {
    const trim = fitSell({ desiredDollars: 400, price: 10, heldShares: 100, marketValue: 1_000, allowFullExit: false });
    expect(trim.ok).toBe(true);
    expect(trim.shares).toBe(40);
    expect(trim.shares).toBeLessThan(100);
    expect(trim.dollars).toBeLessThanOrEqual(400);

    const tooBig = fitSell({ desiredDollars: 50_000, price: 10, heldShares: 10, marketValue: 100, allowFullExit: false });
    expect(tooBig.ok).toBe(false);
    expect(tooBig.shares).toBe(0);
    expect(tooBig.reason).toMatch(/kill condition/i);

    const exit = fitSell({ desiredDollars: 100, price: 10, heldShares: 10, marketValue: 100, allowFullExit: true });
    expect(exit.ok).toBe(true);
    expect(exit.shares).toBe(10);
    expect(exit.dollars).toBe(100);
  });

  it("holds the cash, cap, and share invariants across random books", () => {
    let seed = 17;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 200; i += 1) {
      const price = 5 + rand() * 500;
      const book = 10_000 + rand() * 500_000;
      const market = rand() * book * 0.2;
      const earmarked = rand() * 20_000;
      const dry = rand() * 20_000;
      const desired = rand() * 15_000;
      const fit = fitBuy({
        desiredDollars: desired,
        price,
        earmarked,
        dry,
        marketValue: market,
        bookValue: book,
        positionCap: 0.15,
        useEarmarked: true,
      });
      expect(fit.fromEarmarked).toBeLessThanOrEqual(earmarked + 0.01);
      expect(fit.fromDry).toBeLessThanOrEqual(dry + 0.01);
      expect(fit.fromEarmarked + fit.fromDry).toBeLessThanOrEqual(fit.dollars + 0.02);
      const cap = book * 0.15;
      if (market + 0.01 < cap) {
        expect(market + fit.dollars).toBeLessThanOrEqual(cap + 0.05);
      } else {
        expect(fit.dollars).toBe(0);
        expect(fit.ok).toBe(false);
      }
      if (fit.ok) {
        const priceCents = Math.round(price * 100);
        expect(fit.shares * priceCents).toBeLessThanOrEqual(fit.dollars * 100 + 1);
      }
      const held = 1 + rand() * 100;
      const sell = fitSell({ desiredDollars: rand() * held * price, price, heldShares: held, marketValue: held * price, allowFullExit: false });
      if (sell.ok) {
        expect(sell.shares).toBeLessThanOrEqual(held);
        expect(sell.shares).toBeLessThan(held);
      }
    }
  });
});
