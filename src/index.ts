import { update } from 'lodash';
import _ = require('lodash');
import { SpaceTraders } from 'spacetraders-sdk';
import { Cargo, Marketplace, YourShip, Good, LocationResponse, LocationsResponse, MarketplaceResponse, AccountResponse, User, SellResponse, PurchaseResponse } from 'spacetraders-sdk/dist/types';

export interface LoadedShip {
    ship: YourShip,
    cargoCost?: number,
}

export interface Goods {
    symbol: string,
    highPrice: number,
    lowPrice: number,
    highLoc: string,
    lowLoc: string,
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
const spaceTraders = new SpaceTraders();

spaceTraders.init("Dunador", "15839b0b-d146-4c90-b70d-79cf834d1e8a");
let currentShips: LoadedShip[] = [];
let marketGoods: Goods[] = [];
let currentUser: User;

async function main() {
    while(true) {
        const userResponse = await spaceTraders.getAccount().then((d) => { return d; }, 
        (e) => {console.log(e);});
        currentUser = (userResponse as AccountResponse).user;
        if(_.isEmpty(currentShips)) {
            (userResponse as AccountResponse).user.ships.forEach((ship) => {
                let addShip: LoadedShip = {ship, cargoCost: 0};
                currentShips.push(addShip);
            });
        } else {
            (userResponse as AccountResponse).user.ships.forEach((ship) => {
                let updateShip = currentShips.find((cship) => { return cship.ship.id === ship.id});
                if (updateShip) {
                    (updateShip as LoadedShip).ship = ship;
                } else {
                    currentShips.push({ ship, cargoCost: 0 });
                }

            })
        }
        currentShips.forEach(async (cargoShip) => {
            let shipLoc = cargoShip.ship.location;
            console.log("Current Credits: "+(userResponse as AccountResponse).user.credits);

            if (!_.isEmpty(shipLoc)) {
                console.log("Ship "+cargoShip.ship.id+" currently at "+shipLoc);
                await doSomething(cargoShip);
            } else {
                console.log("Ship "+cargoShip.ship.id+" currently in transit");
            }
        });
        await delay(10000);
    }
}

async function doSomething(cargoShip: LoadedShip) {
    if (cargoShip.ship.location) {
        const stationMarket = await updateMarketData(cargoShip.ship.location);
        await sellGoods(cargoShip, stationMarket);
        await buyGoods(cargoShip, stationMarket);
        await navigate(cargoShip);
    }
}

async function sellGoods(cargoShip: LoadedShip, stationMarket: Marketplace[]) {
    if (cargoShip.ship.cargo.length > 0) {
        console.log("Selling something");
        cargoShip.ship.cargo.forEach(async (item) => {
            if (item.good === "FUEL") {
                const order = await spaceTraders.sellGood(cargoShip.ship.id, "FUEL", item.quantity);
                cargoShip.ship = (order as SellResponse).ship;
            } else {
                const stationGood = stationMarket.find((good) => { return good.symbol == item.good });
                if (stationGood) {
                    const potentialGain = item.quantity * stationGood.pricePerUnit - (cargoShip.cargoCost || 0);
                    if (potentialGain > 0) {
                        const order = await spaceTraders.sellGood(cargoShip.ship.id, item.good, item.quantity).then((d)=>{ return d; },
                        (e) => {
                            console.log(e);
                        });
                        cargoShip.ship = (order as SellResponse).ship;
                        console.log("Ship "+cargoShip.ship.id+" selling "+item.good+" for "+stationGood.pricePerUnit * item.quantity);
                    }
                }
            }
        })
    }
}

async function updateMarketData(location: string) {
    const marketData = await spaceTraders.getMarketplace(location).then((d)=>{ return d; },
    (e) => {
        console.log(e);
    });
    console.log("Updating Market data");
    (marketData as MarketplaceResponse).location.marketplace.forEach((item) => {
        if (item.symbol !== "FUEL") {
            let updateItem = marketGoods.find((good) => { return good.symbol === item.symbol});
            const updateIndex = marketGoods.indexOf(updateItem as Goods);
            console.log(updateIndex);
            if (updateItem) {
                if (item.pricePerUnit > updateItem.highPrice) {
                    updateItem.highPrice = item.pricePerUnit;
                    updateItem.highLoc = location;
                }
                if (item.pricePerUnit < updateItem.lowPrice) {
                    updateItem.lowPrice = item.pricePerUnit;
                    updateItem.lowLoc = location;
                }
                marketGoods[updateIndex] = updateItem;
            } else {
                marketGoods.push({
                   symbol: item.symbol,
                   lowPrice: item.pricePerUnit,
                   lowLoc: location,
                   highPrice: item.pricePerUnit,
                   highLoc: location, 
                });
            }
        }
    });
    console.log(marketGoods);
    return (marketData as MarketplaceResponse).location.marketplace;
}

async function buyGoods(cargoShip: LoadedShip, stationMarket: Marketplace[]) {
    // 20 used for fuel considerations.
    if(cargoShip.ship.spaceAvailable > 20) {
        console.log("In Buying Stuff");
        let largestPriceGapGood: string = '';
        let largestPriceGap: number = 0;
        stationMarket.forEach(async (good) => {
            const itemData = marketGoods.find((item) => { return good.symbol === item.symbol});
            if (itemData && cargoShip.ship.spaceAvailable > 20 && currentUser.credits >= good.pricePerUnit) {
                // Check for insufficient data on goods
                if (itemData.highPrice !== itemData.lowPrice) {
                    if ( itemData.highPrice - good.pricePerUnit > largestPriceGap) {
                        largestPriceGap = itemData.highPrice - good.pricePerUnit;
                        largestPriceGapGood = good.symbol;
                    }
                    if (itemData.lowPrice === good.pricePerUnit) {
                        let quantityToBuy = Math.floor((cargoShip.ship.spaceAvailable - 20) / good.volumePerUnit);
                        if (good.volumePerUnit === 0) {
                            quantityToBuy = Math.floor((currentUser.credits - 500) / good.pricePerUnit);
                        }
                        if (quantityToBuy > good.quantityAvailable) {
                            quantityToBuy = good.quantityAvailable;
                        }
                        cargoShip.ship.spaceAvailable -= quantityToBuy * good.volumePerUnit;
                        console.log("Ship "+cargoShip.ship.id+" buying "+good.symbol+" for "+good.pricePerUnit * quantityToBuy);
                        const order = await spaceTraders.purchaseGood(cargoShip.ship.id, good.symbol, quantityToBuy).then((d) => { return d; }, 
                        (e) => {console.log(e);});
                        currentUser.credits = (order as PurchaseResponse).credits;
                        cargoShip.ship = (order as PurchaseResponse).ship;
                    }
                }
            }
        });
        if (cargoShip.ship.spaceAvailable > 20) {
            const goodToBuy = stationMarket.find((good) => { return good.symbol === largestPriceGapGood});
            if (goodToBuy) {
                const quantityToBuy = Math.floor((cargoShip.ship.spaceAvailable - 20) / goodToBuy.volumePerUnit);
                cargoShip.ship.spaceAvailable -= quantityToBuy * goodToBuy.volumePerUnit;
                console.log("Ship "+cargoShip.ship.id+" buying "+goodToBuy.symbol+" for "+goodToBuy.pricePerUnit * quantityToBuy);
                const order = await spaceTraders.purchaseGood(cargoShip.ship.id, goodToBuy.symbol, quantityToBuy).then((d)=>{ return d; },
                (e) => {
                    console.log(e);
                });
                currentUser.credits = (order as PurchaseResponse).credits;
                cargoShip.ship = (order as PurchaseResponse).ship;
            }
        }
    }
}

async function navigate(cargoShip: LoadedShip) {
    const systemLocations = await spaceTraders.listLocations("OE").then((d)=>{ return d; },
    (e) => {
        console.log(e);
    });
    if (cargoShip.ship.cargo.length > 0) {
        let goodToShip = cargoShip.ship.cargo.find((good) => { return good.good !== "FUEL"});
        if (goodToShip) {
            const goodMarketData = marketGoods.find((good) => { return good.symbol === goodToShip?.good});
            if (goodMarketData && goodMarketData.highLoc) {
                const targetDest = (systemLocations as LocationsResponse).locations.find((loc) => { return loc.symbol === goodMarketData.highLoc});
                const currentLoc = (systemLocations as LocationsResponse).locations.find((loc) => { return loc.symbol === cargoShip.ship.location});
                if (targetDest && currentLoc && (targetDest.symbol !== currentLoc.symbol)) {
                    const distanceToMarket = distance(targetDest.x, currentLoc.x, targetDest.y, currentLoc.y);
                    const penalty = currentLoc.type.toLowerCase() === "planet" ? 2 : 0;
                    const fuelNeeded = Math.round(distanceToMarket / 4) + penalty + 1;
                    while (fuelNeeded > cargoShip.ship.spaceAvailable) {
                        const volumeOfGood = (cargoShip.ship.maxCargo - cargoShip.ship.spaceAvailable) / goodToShip.quantity;
                        await spaceTraders.sellGood(cargoShip.ship.id, goodToShip.good, 1).then((d)=>{ return d; },
                        (e) => {
                            console.log(e);
                        });
                        cargoShip.ship.spaceAvailable += volumeOfGood;
                    }
                    await spaceTraders.purchaseGood(cargoShip.ship.id, "FUEL", fuelNeeded).then((d)=>{ return d; },
                    (e) => {
                        console.log(e);
                    });
                    console.log("Creating regular flight to "+targetDest.symbol);
                    await spaceTraders.createFlightPlan(cargoShip.ship.id, targetDest.symbol).then((d)=>{ return d; },
                    (e) => {
                        console.log(e);
                    });
                } else {
                    await backupNavigation(cargoShip, systemLocations as LocationsResponse);
                }
            } else {
                await backupNavigation(cargoShip, systemLocations as LocationsResponse);
            }
        } else {
            await backupNavigation(cargoShip, systemLocations as LocationsResponse);
        }
    } else {
        await backupNavigation(cargoShip, systemLocations as LocationsResponse);
    }
}

async function backupNavigation(cargoShip: LoadedShip, systemLocs: LocationsResponse) {
    let shortestTrip = cargoShip.ship.location;
    let shortestTripDist = 100;
    const currentLoc = systemLocs.locations.find((loc) => { return loc.symbol === cargoShip.ship.location});
    if (currentLoc) {
        systemLocs.locations.forEach((loc) => {
            if (loc.symbol !== currentLoc.symbol) {
                const distToLoc = distance(currentLoc.x, loc.x, currentLoc.y, loc.y);
                if (distToLoc < shortestTripDist) {
                    shortestTripDist = distToLoc;
                    shortestTrip = loc.symbol;
                }
            }
        });
        const targetLoc = systemLocs.locations.find((loc) => { return loc.symbol === shortestTrip});
        if (targetLoc) {

            const penalty = currentLoc.type.toLowerCase() === "planet" ? 2 : 0;
            const fuelNeeded = Math.round(shortestTripDist / 4) + penalty + 1;
            let goodToShip = cargoShip.ship.cargo.find((good) => { return good.good != "FUEL"});
            while (fuelNeeded > cargoShip.ship.spaceAvailable) {
                const volumeOfGood = (cargoShip.ship.maxCargo - cargoShip.ship.spaceAvailable) / (goodToShip as Cargo).quantity;
                await spaceTraders.sellGood(cargoShip.ship.id, (goodToShip as Cargo).good, 1).then((d)=>{ return d; },
                (e) => {
                    console.log(e);
                });
                cargoShip.ship.spaceAvailable += volumeOfGood;
            }
            await spaceTraders.purchaseGood(cargoShip.ship.id, "FUEL", fuelNeeded).then((d)=>{ return d; },
            (e) => {
                console.log(e);
            });
            console.log("Creating backup nav to "+shortestTrip);
            await spaceTraders.createFlightPlan(cargoShip.ship.id, shortestTrip as string).then((d)=>{ return d; },
            (e) => {
                console.log(e);
            });
        }
    } 
}

function distance(x1: number, x2: number, y1: number, y2: number) {
    const xdiff = Math.pow(x2 - x1, 2);
    const ydiff = Math.pow(y2 - y1, 2);
    return Math.ceil(Math.sqrt(xdiff+ydiff));
}

main();

