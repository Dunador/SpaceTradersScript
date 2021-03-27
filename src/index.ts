import * as _ from 'lodash';
import { SpaceTraders } from 'spacetraders-sdk';
import { Cargo, Marketplace, YourShip, LocationsResponse, MarketplaceResponse, AccountResponse, User, SellResponse, PurchaseResponse, Ship, Location } from 'spacetraders-sdk/dist/types';

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
    fuelToMarket: number,
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
const spaceTraders = new SpaceTraders();

spaceTraders.init("Dunador", "892541ab-9ecd-4cbf-a9a9-c61600fbd6e5");
let currentShips: LoadedShip[] = [];
let currentShip: LoadedShip;
let marketGoods: Goods[] = [];
let currentUser: User;
const shipsToBuy: any = {
    Gravager: {
        "MK-I": 20,
        "MK-II":10,
        "MK-III":5,
    },
    Jackshaw: {
        "MK-I": 10,
        "MK-II":0,
        "MK-III":0,
    },
    Electrum: {
        "MK-I":0,
        "MK-II":0,
        "MK-III":0,
    },
    Zetra: {
        "MK-I":0,
        "MK-II":0,
    }
};

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
        await checkPurchaseNewShip();
        await delay(10000);
    }
}

async function doSomething() {
    if (currentShip.ship.location) {
        const stationMarket = await updateMarketData(currentShip.ship.location);
        await sellGoods(stationMarket);
        await delay(500);
        await buyGoods(stationMarket);
        await navigate();
    }
}

async function sellGoods(stationMarket: Marketplace[]) {
    if (currentShip.ship.cargo.length > 0) {
        for (const item of currentShip.ship.cargo) {
            if (item.good === "FUEL") {
                try {
                    const order = await spaceTraders.sellGood(currentShip.ship.id, "FUEL", item.quantity);
                    currentShip.ship = (order as SellResponse).ship;
                } catch (e) {
                    console.log(e);
                }
            } else {
                const stationGood = stationMarket.find((good) => { return good.symbol == item.good });
                if (stationGood) {
                    const potentialGain = item.quantity * stationGood.pricePerUnit - (currentShip.cargoCost || 0);
                    if (potentialGain > 0) {
                        await delay(500);
                        try {
                            const order = await spaceTraders.sellGood(currentShip.ship.id, item.good, item.quantity);
                            currentShip.ship = order.ship;
                            currentUser.credits = order.credits;
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
    let marketData;
    try {
        marketData = await spaceTraders.getMarketplace(location);
    } catch (e) {
        console.log(e);
    }

    console.log("Updating Market data");
    for (const item of (marketData as MarketplaceResponse).location.marketplace) {
        if (item.symbol !== "FUEL") {
            let updateItem = marketGoods.find((good) => { return good.symbol === item.symbol});
            const updateIndex = marketGoods.indexOf(updateItem as Goods);
            if (updateItem) {
                const lowLoc = (await spaceTraders.getLocation(updateItem.lowLoc)).location;
                const highLoc = (await spaceTraders.getLocation(updateItem.highLoc)).location;
                const currLoc = (await spaceTraders.getLocation(location)).location;
                if (item.pricePerUnit >= updateItem.highPrice || location === updateItem.highLoc) {
                    if (item.pricePerUnit > updateItem.highPrice) {
                        updateItem.highPrice = item.pricePerUnit;
                        updateItem.highLoc = location;
                    } else if (distance(lowLoc, currLoc) < distance(lowLoc, highLoc)) {
                        updateItem.highPrice = item.pricePerUnit;
                        updateItem.highLoc = location;
                    }
                }
                if (item.pricePerUnit <= updateItem.lowPrice || location === updateItem.lowLoc) {
                    if (item.pricePerUnit > updateItem.lowPrice) {
                        updateItem.lowPrice = item.pricePerUnit;
                        updateItem.lowLoc = location;
                    } else if (distance(highLoc, currLoc) < distance(lowLoc, highLoc)) {
                        updateItem.lowPrice = item.pricePerUnit;
                        updateItem.lowLoc = location;
                    }
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
    let goodsAvailable: PurchaseGoods[] = [];
    for (const good of stationMarket) {
        const itemData = marketGoods.find((item) => { return good.symbol === item.symbol});
        if (itemData) {
            let fuelNeeded = (await calculateFuelNeededForGood(itemData.symbol)).fuelNeeded;
            if (good.volumePerUnit > 0) {
                goodsAvailable.push({good, gainPerQty: (itemData.highPrice - good.pricePerUnit) / good.volumePerUnit / fuelNeeded, fuelToMarket: fuelNeeded});
            } else {
                goodsAvailable.push({good, gainPerQty: (itemData.highPrice - good.pricePerUnit) / 0.1 / fuelNeeded, fuelToMarket: fuelNeeded});
            }
        }
    }
    goodsAvailable = _.sortBy(goodsAvailable, ['gainPerQty']);
    goodsAvailable = _.reverse(goodsAvailable);

    console.log(goodsAvailable);

    for (const purchaseGood of goodsAvailable) {
        const good: Marketplace = purchaseGood.good;
        if (currentShip.ship.spaceAvailable > purchaseGood.fuelToMarket && purchaseGood.gainPerQty > 0 && (currentUser.credits - 500) > good.pricePerUnit) {
            let quantityToBuy = Math.floor((currentShip.ship.spaceAvailable - purchaseGood.fuelToMarket) / good.volumePerUnit);
            if (good.volumePerUnit === 0) {
                quantityToBuy = Math.floor((currentUser.credits - 3000) / good.pricePerUnit);
            }
            if ((quantityToBuy * good.pricePerUnit) >= currentUser.credits) {
                quantityToBuy = Math.floor((currentUser.credits - 3000) / good.pricePerUnit);
            }
            if (quantityToBuy >= good.quantityAvailable) {
                quantityToBuy = good.quantityAvailable - 1;
            }
            if (quantityToBuy > 0) {
                currentShip.ship.spaceAvailable -= quantityToBuy * good.volumePerUnit;
                try {
                    const order = await spaceTraders.purchaseGood(currentShip.ship.id, good.symbol, quantityToBuy);
                    currentShip.ship = order.ship;
                    currentUser.credits = order.credits;
                    console.log("Ship "+currentShip.ship.id+" buying "+good.symbol+" for "+good.pricePerUnit * quantityToBuy);
                    await delay(500);
                } catch (e) {
                    console.log(e);
                    continue;
                }
            }
        }
    }
}

async function navigate() {
    const targetData = await calculateFuelNeededForGood();
    const targetDest = targetData.targetDest;
    const fuelNeeded = targetData.fuelNeeded;
    while (fuelNeeded > currentShip.ship.spaceAvailable) {
        try {
            const o = await spaceTraders.sellGood(currentShip.ship.id, currentShip.ship.cargo[0].good, 1);
            currentShip.ship = o.ship;
        } catch (e) {
            console.log(e);
        }
    }

    try {
        let tmp = await spaceTraders.purchaseGood(currentShip.ship.id, "FUEL", fuelNeeded);
        currentShip.ship = tmp.ship;
    } catch (e) {
        console.log(e);
    }

    try {
        console.log("Creating flight to "+targetDest);
        await spaceTraders.createFlightPlan(currentShip.ship.id, targetDest);
    } catch (e) {
        console.log(e);
    }
}

async function backupNavigation(systemLocs: LocationsResponse) {
    let shortestTrip = currentShip.ship.location;
    let shortestTripDist = 1000;
    const currentLoc = systemLocs.locations.find((loc) => { return loc.symbol === currentShip.ship.location}) as Location;
    for (const loc of systemLocs.locations) {
        if (loc.symbol !== currentLoc.symbol) {
            const distToLoc = distance(currentLoc, loc);
            if (distToLoc < shortestTripDist) {
                shortestTripDist = distToLoc;
                shortestTrip = loc.symbol;
            }
        }
    }
    const targetLoc = systemLocs.locations.find((loc) => { return loc.symbol === shortestTrip}) as Location;
    const penalty = currentLoc.type.toLowerCase() === "planet" ? 2 : 0;
    const fuelNeeded = Math.round(shortestTripDist / 4) + penalty + 1;
    return {targetDest: targetLoc.symbol, fuelNeeded};
}

async function checkPurchaseNewShip() {
    const availShips = await spaceTraders.viewAvailableShips();
    for (let ship of availShips.ships) {
        for (let purchaseLocation of ship.purchaseLocations) {
            if (
                // Use 50,000 credits per ship as safe trading gap when buying new ships
                (((currentShips.length * 50000) + purchaseLocation.price) <= currentUser.credits) &&
                shipsToBuy[ship.manufacturer][ship.class] > _.filter(currentShips, (currShip) => {
                    return (currShip.ship.manufacturer === ship.manufacturer && currShip.ship.class === ship.class);
                }).length
            ) {
                try {
                    await spaceTraders.purchaseShip(purchaseLocation.location, ship.type);
                    console.log("Purchasing "+ship.type+" for "+purchaseLocation.price);
                    currentUser.credits -= purchaseLocation.price;
                    await delay(500);
                } catch (e) {
                    console.log(e);
                }
            }
        }
    }
}

async function calculateFuelNeededForGood(good?: string) {
    let systemLocations;
    try {
        systemLocations = await spaceTraders.listLocations("OE");
    } catch (e) {
        console.log(e);
    }
    // Need both conditions.  When determing distance for buying purposes, the cargo will always be empty.  When determining navigation, cargo should never be empty
    if (currentShip.ship.cargo.length > 0 || !_.isEmpty(good)) {
        let goodToShip: string;
        if (good) {
            goodToShip = good;
        } else {
            goodToShip = currentShip.ship.cargo.find((good) => { return (good.good !== "FUEL" && good.good !== "RESEARCH")})?.good as string;
        }
        if (goodToShip) {
            const goodMarketData = marketGoods.find((good) => { return good.symbol === goodToShip});
            if (goodMarketData && goodMarketData.highLoc) {
                const targetDest = (systemLocations as LocationsResponse).locations.find((loc) => { return loc.symbol === goodMarketData.highLoc});
                const currentLoc = (systemLocations as LocationsResponse).locations.find((loc) => { return loc.symbol === currentShip.ship.location});
                if (targetDest && currentLoc && (targetDest.symbol !== currentLoc.symbol)) {
                    const distanceToMarket = distance(targetDest, currentLoc);
                    const penalty = currentLoc.type.toLowerCase() === "planet" ? 2 : 0;
                    const fuelNeeded = Math.round(distanceToMarket / 4) + penalty + 1;
                    return {targetDest: targetDest.symbol, fuelNeeded};
                } else {
                    return backupNavigation(systemLocations as LocationsResponse);
                }
            } else {
                return backupNavigation(systemLocations as LocationsResponse);
            }
        } else {
            return backupNavigation(systemLocations as LocationsResponse);
        }
    } else {
        return backupNavigation(systemLocations as LocationsResponse);
    }
}

function distance(loc1: Location, loc2: Location) {
    const xdiff = Math.pow(loc2.x - loc1.x, 2);
    const ydiff = Math.pow(loc2.y - loc1.y, 2);
    return Math.ceil(Math.sqrt(xdiff+ydiff));
}

main();

