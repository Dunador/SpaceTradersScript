import { SpaceTraders } from "spacetraders-sdk";
import { Location, LocationWithMarketplace } from "spacetraders-sdk/dist/types";
import { Goods } from "../types";

let credits: number = 0;
let creditsToMaintain: number = 0;
export let bestRoutesPerSystem: Map<string, Goods[]> = new Map();
export let locationMap: Map<string, Location[]> = new Map();
export let universeMarkets: Map<string, LocationWithMarketplace[]> = new Map();
export const spaceTraders: SpaceTraders = new SpaceTraders();
export const knownSystems = ['OE', 'XV'];

export function getCredits(): number {
  return credits;
}

export function addCredits(creditsToAdd: number) {
  credits += creditsToAdd;
}

export function setCredits(creds: number) {
  credits = creds;
}

export function getCreditsToMaintain(): number {
  return creditsToMaintain;
}

export function addToCreditsToMaintain(add: number) {
  creditsToMaintain += add;
}
