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
let token: string = "ddfb6d61-a6d1-485d-a79e-279ec2586742";
const username: string = "DunadorRedo";
globals.spaceTraders.init(username, token).then(() => {}, async () => {
  newAccount();
});
let intraTraders: IntraSystemTrader[] = [];
let locationScouts: LocationScout[] = [];
const shipsToBuy: Map<string, any> = new Map();

async function main() {
  initialize();
  MarketUtil.startStreamingMarketData();
  while (true) {
    try {
      try {
        await globals.spaceTraders.getAccount().then((d) => {
          globals.setCredits(d.user.credits);
        }, async () => {
          //newAccount();
          //initialize();
        });
        await globals.spaceTraders.getShips().then(
          async (d) => {
            globals.setAllShips(d.ships);
            if (_.isEmpty(intraTraders)) {
              for (const ship of d.ships) {
                let trader = new IntraSystemTrader(ship);
                if (ship.location) {
                  trader.system = ship.location.substring(0, 2);
                } else {
                  try {
                    trader.system = await (
                      await globals.spaceTraders.getFlightPlan(ship.flightPlanId)
                    ).flightPlan.destination.substring(0, 2);
                  } catch (e) {
                    console.log(e);
                  }
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
                  try {
                    const flight = await globals.spaceTraders.getFlightPlan(
                      ship.flightPlanId
                    );
                    system = flight.flightPlan.destination.substring(0, 2);
                  }
                  catch (e) {
                    console.log(e);
                  }
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
        // await MarketUtil.updateMarketData();
      } catch (e) {
        console.log(e);
      }

      for (const cargoShip of intraTraders) {
        await cargoShip.handleTrade();
      }
      await checkPurchaseNewShip();
    } catch (e) {
      console.log(e);
    }
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
          purchaseLocation.location.substring(0, 2) === system &&
          globals.getAllShips().find(ship => ship.location === purchaseLocation.location)
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

async function initialize () {
  globals.knownSystems.forEach(async (system) => {
    const locations = (await globals.spaceTraders.listLocations(system))
      .locations;
    globals.locationMap.set(
      system,
      locations.filter((loc) => loc.type !== "WORMHOLE")
    );
    globals.bestRoutesPerSystem.set(system, []);
    globals.universeMarkets.set(system, []);
    globals.setCredits(0);
    globals.setAllShips([]);
    shipsToBuy.set(system, {
      Gravager: {
        "MK-I": 0,
        "MK-II": 0,
        "MK-III": 15,
      },
      Jackshaw: {
        "MK-I": 21,
        "MK-II": 0,
        "MK-III": 0,
      },
      Electrum: {
        "MK-I": 0,
        "MK-II": 0,
        "MK-III": 0,
        "MK-IV": 0
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
}

async function newAccount() {
  await globals.spaceTraders.init(username);
  await globals.spaceTraders.takeOutLoan("STARTUP");
}

main();

setInterval(() => {
  generateDisplay(intraTraders, globals.bestRoutesPerSystem);
}, 15000).unref();
