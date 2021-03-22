import { update } from 'lodash';
import _ = require('lodash');
import { SpaceTraders } from 'spacetraders-sdk';
import { Cargo, Marketplace, YourShip, Good, LocationResponse, LocationsResponse, MarketplaceResponse, AccountResponse, User, SellResponse, PurchaseResponse, FlightPlanResponse } from 'spacetraders-sdk/dist/types';

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

export interface PurchaseGoods {
    good: Marketplace,
    gainPerQty: number,
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
const spaceTraders = new SpaceTraders();

spaceTraders.init("Dunador", "892541ab-9ecd-4cbf-a9a9-c61600fbd6e5");
let currentShips: LoadedShip[] = [];
let currentShip: LoadedShip;
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
            currentShip = cargoShip;
            let shipLoc = cargoShip.ship.location;
            console.log("Current Credits: "+(userResponse as AccountResponse).user.credits);

            if (!_.isEmpty(shipLoc)) {
                console.log("Ship "+cargoShip.ship.id+" currently at "+shipLoc);
                await doSomething();
            } else {
                console.log("Ship "+cargoShip.ship.id+" currently in transit");
            }
        });
        await delay(10000);
    }
}

async function doSomething() {
    if (currentShip.ship.location) {
        const stationMarket = await updateMarketData(currentShip.ship.location);
        await sellGoods(stationMarket);
        await delay(2000);
        await buyGoods(stationMarket);
        await navigate();
    }
}

async function sellGoods(stationMarket: Marketplace[]) {
    if (currentShip.ship.cargo.length > 0) {
        currentShip.ship.cargo.forEach(async (item) => {
            if (item.good === "FUEL") {
                const order = await spaceTraders.sellGood(currentShip.ship.id, "FUEL", item.quantity);
                currentShip.ship = (order as SellResponse).ship;
            } else {
                const stationGood = stationMarket.find((good) => { return good.symbol == item.good });
                if (stationGood) {
                    const potentialGain = item.quantity * stationGood.pricePerUnit - (currentShip.cargoCost || 0);
                    if (potentialGain > 0) {
                        await delay(2000);
                        const order = await spaceTraders.sellGood(currentShip.ship.id, item.good, item.quantity).then((d)=>{ return d; },
                        (e) => {
                            console.log(e);
                        });
                        console.log(order);
                        currentShip.ship = (order as SellResponse).ship;
                        currentShips[0].ship = (order as SellResponse).ship;
                        console.log("Ship "+currentShip.ship.id+" selling "+item.good+" for "+(order as SellResponse).order.total);
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
    return (marketData as MarketplaceResponse).location.marketplace;
}

async function buyGoods(stationMarket: Marketplace[]) {
    // 20 used for fuel considerations.
    let goodsAvailable: PurchaseGoods[] = [];
    stationMarket.forEach(async (good) => {
        const itemData = marketGoods.find((item) => { return good.symbol === item.symbol});
        if (itemData) {
            goodsAvailable.push({good, gainPerQty: itemData.highPrice - good.pricePerUnit});
        }
    });
    goodsAvailable = _.sortBy(goodsAvailable, ['gainPerQty']);
    goodsAvailable = _.reverse(goodsAvailable);

    const good: Marketplace = goodsAvailable[0].good;
    if (currentShip.ship.spaceAvailable > 20 && currentShip.ship.cargo.length === 0) {
        let quantityToBuy = Math.floor((currentShip.ship.spaceAvailable - 20) / good.volumePerUnit);
        if (good.volumePerUnit === 0) {
            quantityToBuy = Math.floor((currentUser.credits - 500) / good.pricePerUnit);
        }
        if (quantityToBuy > good.quantityAvailable) {
            quantityToBuy = good.quantityAvailable;
        }
        if (quantityToBuy * good.pricePerUnit > currentUser.credits) {
            quantityToBuy = Math.floor(currentUser.credits / good.pricePerUnit);
        }
        currentShip.ship.spaceAvailable -= quantityToBuy * good.volumePerUnit;
        console.log("Ship "+currentShip.ship.id+" buying "+good.symbol+" for "+good.pricePerUnit * quantityToBuy);
        const order = await spaceTraders.purchaseGood(currentShip.ship.id, good.symbol, quantityToBuy).then((d) => { return d; }, 
        (e) => {console.log(e);});
        currentUser.credits = (order as PurchaseResponse).credits;
        currentShip.ship = (order as PurchaseResponse).ship;
    }
}

async function navigate() {
    const systemLocations = await spaceTraders.listLocations("OE").then((d)=>{ return d; },
    (e) => {
        console.log(e);
    });
    if (currentShip.ship.cargo.length > 0) {
        let goodToShip = currentShip.ship.cargo.find((good) => { return good.good !== "FUEL"});
        if (goodToShip) {
            const goodMarketData = marketGoods.find((good) => { return good.symbol === goodToShip?.good});
            if (goodMarketData && goodMarketData.highLoc) {
                const targetDest = (systemLocations as LocationsResponse).locations.find((loc) => { return loc.symbol === goodMarketData.highLoc});
                const currentLoc = (systemLocations as LocationsResponse).locations.find((loc) => { return loc.symbol === currentShip.ship.location});
                if (targetDest && currentLoc && (targetDest.symbol !== currentLoc.symbol)) {
                    const distanceToMarket = distance(targetDest.x, currentLoc.x, targetDest.y, currentLoc.y);
                    const penalty = currentLoc.type.toLowerCase() === "planet" ? 2 : 0;
                    const fuelNeeded = Math.round(distanceToMarket / 4) + penalty + 1;
                    while (fuelNeeded > currentShip.ship.spaceAvailable) {
                        const volumeOfGood = (currentShip.ship.maxCargo - currentShip.ship.spaceAvailable) / goodToShip.quantity;
                        const o = await spaceTraders.sellGood(currentShip.ship.id, goodToShip.good, 1).then((d)=>{ return d; },
                        (e) => {
                            console.log(e);
                        });
                        currentShip.ship = (o as SellResponse).ship;
                    }
                    let tmp = await spaceTraders.purchaseGood(currentShip.ship.id, "FUEL", fuelNeeded).then((d)=>{ return d; },
                    (e) => {
                        console.log(e);
                    });
                    currentShip.ship = (tmp as SellResponse).ship;
                    console.log("Creating regular flight to "+targetDest.symbol);
                    await spaceTraders.createFlightPlan(currentShip.ship.id, targetDest.symbol).then((d)=>{ return d; },
                    (e) => {
                        console.log(e);
                    });
                } else {
                    await backupNavigation(systemLocations as LocationsResponse);
                }
            } else {
                await backupNavigation(systemLocations as LocationsResponse);
            }
        } else {
            await backupNavigation(systemLocations as LocationsResponse);
        }
    } else {
        await backupNavigation(systemLocations as LocationsResponse);
    }
}

async function backupNavigation(systemLocs: LocationsResponse) {
    let shortestTrip = currentShip.ship.location;
    let shortestTripDist = 100;
    const currentLoc = systemLocs.locations.find((loc) => { return loc.symbol === currentShip.ship.location});
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
            let goodToShip = currentShip.ship.cargo.find((good) => { return good.good != "FUEL"});
            while (fuelNeeded > currentShip.ship.spaceAvailable) {
                const volumeOfGood = (currentShip.ship.maxCargo - currentShip.ship.spaceAvailable) / (goodToShip as Cargo).quantity;
                const o = await spaceTraders.sellGood(currentShip.ship.id, (goodToShip as Cargo).good, 1).then((d)=>{ return d; },
                (e) => {
                    console.log(e);
                });
                currentShip.ship = (o as SellResponse).ship;
            }
            const o = await spaceTraders.purchaseGood(currentShip.ship.id, "FUEL", fuelNeeded).then((d)=>{ return d; },
            (e) => {
                console.log(e);
            });
            currentShip.ship = (o as SellResponse).ship;

            console.log("Creating backup nav to "+shortestTrip);
            await spaceTraders.createFlightPlan(currentShip.ship.id, shortestTrip as string).then((d)=>{ return d; },
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

