import * as _ from 'lodash';
import { SpaceTraders } from 'spacetraders-sdk';
import { Cargo, Marketplace, YourShip, LocationsResponse, MarketplaceResponse, AccountResponse, User, SellResponse, PurchaseResponse } from 'spacetraders-sdk/dist/types';

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
        let userResponse;
        try {
            userResponse = await spaceTraders.getAccount().then((d) => { 
                currentUser = (d as AccountResponse).user;
                if(_.isEmpty(currentShips)) {
                    for (const ship of (d as AccountResponse).user.ships) {
                        let addShip: LoadedShip = {ship, cargoCost: 0};
                        currentShips.push(addShip);
                    }
                } else {
                    for (const ship of (d as AccountResponse).user.ships) {
                        let updateShip = currentShips.find((cship) => { return cship.ship.id === ship.id});
                        if (updateShip) {
                            (updateShip as LoadedShip).ship = ship;
                        } else {
                            currentShips.push({ ship, cargoCost: 0 });
                        }
                    }
                }
    
                return d; 
            }, 
            (e) => {console.log(e);});
        } catch (e) {
            console.log(e);
        }
        
        for (const cargoShip of currentShips) {
            currentShip = cargoShip;
            let shipLoc = cargoShip.ship.location;
            console.log("Current Credits: "+(userResponse as AccountResponse).user.credits);

            if (!_.isEmpty(shipLoc)) {
                console.log("Ship "+cargoShip.ship.id+" currently at "+shipLoc);
                await doSomething();
            } else {
                console.log("Ship "+cargoShip.ship.id+" currently in transit");
            }
        }
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
        for (const item of currentShip.ship.cargo) {
            if (item.good === "FUEL") {
                const order = await spaceTraders.sellGood(currentShip.ship.id, "FUEL", item.quantity);
                currentShip.ship = (order as SellResponse).ship;
            } else {
                const stationGood = stationMarket.find((good) => { return good.symbol == item.good });
                if (stationGood) {
                    const potentialGain = item.quantity * stationGood.pricePerUnit - (currentShip.cargoCost || 0);
                    if (potentialGain > 0) {
                        await delay(2000);
                        try {
                            const order = await spaceTraders.sellGood(currentShip.ship.id, item.good, item.quantity).then((d)=>{ 
                                console.log(d);
                                currentShip.ship = d.ship;
                                currentUser.credits = d.credits;
                                return d; 
                            },
                            (e) => {
                                console.log(e);
                            });
                            console.log("Ship "+currentShip.ship.id+" selling "+item.good+" for "+(order as SellResponse).order.total);
                        } catch (e) {
                            console.log(e);
                            continue;
                        }
                    }
                }
            }
        }
    }
}

async function updateMarketData(location: string) {
    const marketData = await spaceTraders.getMarketplace(location).then((d)=>{ return d; },
    (e) => {
        console.log(e);
    });
    console.log("Updating Market data");
    for (const item of (marketData as MarketplaceResponse).location.marketplace) {
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
    }
    return (marketData as MarketplaceResponse).location.marketplace;
}

async function buyGoods(stationMarket: Marketplace[]) {
    // 20 used for fuel considerations.
    let goodsAvailable: PurchaseGoods[] = [];
    for (const good of stationMarket) {
        const itemData = marketGoods.find((item) => { return good.symbol === item.symbol});
        if (itemData) {
            goodsAvailable.push({good, gainPerQty: itemData.highPrice - good.pricePerUnit});
        }
    }
    goodsAvailable = _.sortBy(goodsAvailable, ['gainPerQty']);
    goodsAvailable = _.reverse(goodsAvailable);

    for (const purchaseGood of goodsAvailable) {
        const good: Marketplace = purchaseGood.good;
        if (currentShip.ship.spaceAvailable > 20 && purchaseGood.gainPerQty > 0 && (currentUser.credits - 500) > good.pricePerUnit) {
            let quantityToBuy = Math.floor((currentShip.ship.spaceAvailable - 20) / good.volumePerUnit);
            if (good.volumePerUnit === 0) {
                quantityToBuy = Math.floor((currentUser.credits - 3000) / good.pricePerUnit);
            }
            if (quantityToBuy > good.quantityAvailable) {
                quantityToBuy = good.quantityAvailable;
            }
            if ((quantityToBuy * good.pricePerUnit) >= currentUser.credits) {
                quantityToBuy = Math.floor((currentUser.credits - 3000) / good.pricePerUnit);
            }
            if (quantityToBuy > 0) {
                currentShip.ship.spaceAvailable -= quantityToBuy * good.volumePerUnit;
                try {
                    await spaceTraders.purchaseGood(currentShip.ship.id, good.symbol, quantityToBuy).then((d) => { 
                        console.log(d);
                        currentShip.ship = d.ship;
                        currentUser.credits = d.credits;
                        return d; 
                    }, 
                    (e) => {console.log(e);})
                    .catch((e) => {console.log(e);});
                    console.log("Ship "+currentShip.ship.id+" buying "+good.symbol+" for "+good.pricePerUnit * quantityToBuy);
                    await delay(2000);
                } catch (e) {
                    console.log(e);
                    continue;
                }
            }
        }
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
                    try {
                        console.log("Creating regular flight to "+targetDest.symbol);
                        await spaceTraders.createFlightPlan(currentShip.ship.id, targetDest.symbol).then((d)=>{ return d; },
                        (e) => {
                            console.log(e);
                        });
                    } catch (e) {
                        console.log(e);
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
    } else {
        await backupNavigation(systemLocations as LocationsResponse);
    }
}

async function backupNavigation(systemLocs: LocationsResponse) {
    let shortestTrip = currentShip.ship.location;
    let shortestTripDist = 100;
    const currentLoc = systemLocs.locations.find((loc) => { return loc.symbol === currentShip.ship.location});
    if (currentLoc) {
        for (const loc of systemLocs.locations) {
            if (loc.symbol !== currentLoc.symbol) {
                const distToLoc = distance(currentLoc.x, loc.x, currentLoc.y, loc.y);
                if (distToLoc < shortestTripDist) {
                    shortestTripDist = distToLoc;
                    shortestTrip = loc.symbol;
                }
            }
        }
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

            try {
                console.log("Creating backup nav to "+shortestTrip);
                await spaceTraders.createFlightPlan(currentShip.ship.id, shortestTrip as string).then((d)=>{ return d; },
                (e) => {
                    console.log(e);
                });
            } catch (e) {
                console.log(e);
            }
        }
    } 
}

function distance(x1: number, x2: number, y1: number, y2: number) {
    const xdiff = Math.pow(x2 - x1, 2);
    const ydiff = Math.pow(y2 - y1, 2);
    return Math.ceil(Math.sqrt(xdiff+ydiff));
}

main();

