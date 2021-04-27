import * as _ from "lodash";
import { groupBy } from "lodash";
import { SpaceTraders } from "spacetraders-sdk";
import {
  Cargo,
  Marketplace,
  YourShip,
  LocationsResponse,
  MarketplaceResponse,
  AccountResponse,
  User,
  SellResponse,
  PurchaseResponse,
  Ship,
  Location,
  LocationWithMarketplace,
} from "spacetraders-sdk/dist/types";
import { IntraSystemTrader } from "./classes/IntraSystemTrader";
import { LocationScout } from "./classes/LocationScout";
import { generateDisplay, log } from "./monitor/monitor";
import { LoadedShip, Goods } from "./types";
import * as globals from "./utils/globals";
import { MarketUtil } from "./utils/marketUtil";

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

globals.spaceTraders.init("Dunador", "69de7c70-4e32-43b5-bac0-98fc5ad7e920");
// let currentShips: LoadedShip[] = [];
// let currentShip: LoadedShip;
let intraTraders: IntraSystemTrader[] = [];
let locationScouts: LocationScout[] = [];
const shipsToBuy: Map<string, any> = new Map();

async function main() {
  globals.knownSystems.forEach(async (system) => {
    const locations = (await globals.spaceTraders.listLocations(system))
      .locations;
    globals.locationMap.set(
      system,
      locations.filter((loc) => loc.type !== "WORMHOLE")
    );
    globals.bestRoutesPerSystem.set(system, []);
    globals.universeMarkets.set(system, []);
    shipsToBuy.set(system, {
      Gravager: {
        "MK-I": 10,
        "MK-II": 0,
        "MK-III": 30,
      },
      Jackshaw: {
        "MK-I": 0,
        "MK-II": 0,
        "MK-III": 0,
      },
      Electrum: {
        "MK-I": 0,
        "MK-II": 0,
        "MK-III": 0,
      },
      Zetra: {
        "MK-I": 0,
        "MK-II": 0,
      },
      Hermes: {
        "MK-I": 0,
        "MK-II": 0,
        "MK-III": 15,
      },
    });
  });
  try {


    while (true) {
      try {
        await globals.spaceTraders.getAccount().then((d) => {
          globals.setCredits(d.user.credits);
        });
        await globals.spaceTraders.getShips().then(
          async (d) => {
            if (_.isEmpty(intraTraders)) {
              for (const ship of d.ships) {
                let trader = new IntraSystemTrader(ship);
                if (ship.location) {
                  trader.system = ship.location.substring(0, 2);
                } else {
                  trader.system = await (
                    await globals.spaceTraders.getFlightPlan(ship.flightPlanId)
                  ).flightPlan.destination.substring(0, 2);
                }
                if (ship.manufacturer === "Jackshaw")
                  locationScouts.push(new LocationScout(ship, trader.system));
                else intraTraders.push(trader);
              }
            } else {
              for (const ship of d.ships) {
                let updateShip;
                if (ship.manufacturer === "Jackshaw")
                  updateShip = locationScouts.find((scout) => {
                    return scout.ship.id === ship.id;
                  });
                else
                  updateShip = intraTraders.find((cship) => {
                    return cship.ship.id === ship.id;
                  });
                let system: string;
                if (ship.location) {
                  system = ship.location.substring(0, 2);
                } else {
                  const flight = await globals.spaceTraders.getFlightPlan(
                    ship.flightPlanId
                  );
                  system = flight.flightPlan.destination.substring(0, 2);
                }

                if (updateShip) {
                  updateShip.system = system;
                  updateShip.ship = ship;
                } else {
                  if (ship.manufacturer === "Jackshaw")
                    locationScouts.push(new LocationScout(ship, system));
                  else intraTraders.push(new IntraSystemTrader(ship, system));
                }
              }
            }

            return d;
          },
          (e) => { }
        );
        await MarketUtil.updateMarketData(locationScouts);
      } catch (e) {
        console.log(e);
      }

      for (const cargoShip of intraTraders) {
        await cargoShip.handleTrade();
      }
      await checkPurchaseNewShip();
    }
  } catch (e) {
    console.log(e);
  }
}

async function checkPurchaseNewShip() {
  const availShips = await globals.spaceTraders.viewAvailableShips();
  let creditsToHold = 0;
  // Keep 100 credits per open cargo space
  intraTraders.forEach((ship) => {
    if (ship.ship.manufacturer !== "Jackshaw")
      creditsToHold += ship.ship.maxCargo * 100;
  });
  for (let ship of availShips.ships) {
    for (let purchaseLocation of ship.purchaseLocations) {
      for (let [system, shipsInSystemToBuy] of shipsToBuy) {
        if (
          creditsToHold + purchaseLocation.price <= globals.getCredits() &&
          shipsInSystemToBuy[ship.manufacturer][ship.class] >
          _.filter(intraTraders, (currShip) => {
            return (
              currShip.ship.manufacturer === ship.manufacturer &&
              currShip.ship.class === ship.class &&
              currShip.system === system
            );
          }).length &&
          purchaseLocation.location.substring(0, 2) === system
        ) {
          try {
            await globals.spaceTraders.purchaseShip(
              purchaseLocation.location,
              ship.type
            );
            globals.addCredits(purchaseLocation.price * -1);
            // Only buy 1 ship per loop, to prevent massive decrease in credits.
            return;
          } catch (e) {
            console.log(e);
          }
        }
      }
    }
  }
}

main();

// setInterval(() => {
//   generateDisplay(intraTraders, globals.bestRoutesPerSystem);
// }, 5000).unref();
