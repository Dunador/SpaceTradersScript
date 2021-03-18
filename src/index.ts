import { SpaceTraders } from 'spacetraders-sdk';
import { Cargo, YourShip } from 'spacetraders-sdk/dist/types';

export interface CargoItem extends Cargo {
    bestPrice?: number,
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
const spaceTraders = new SpaceTraders();

spaceTraders.init("Dunador", "15839b0b-d146-4c90-b70d-79cf834d1e8a");

export enum metalRoute {
    "OE-PM"="BUY",
    "OE-PM-TR"="SELL",
}

async function main() {
    while(true) {
        const userResponse = await spaceTraders.getAccount();
        const metalShip = userResponse.user.ships[0];
        let shipLoc = metalShip.location;
        console.log("Ship currently at: "+shipLoc);
        let shipInv = metalShip.cargo;
        console.log("Current Credits: "+userResponse.user.credits);

        if (shipLoc == "OE-PM-TR") {
            buyLoop(metalShip);
            await delay(100 * 1000);
        }

        if (shipLoc == "OE-PM") {
            sellLoop(metalShip);
            await delay(100 * 1000);
        }
    }
}

async function buyLoop(ship: YourShip) {
    let market: any = await spaceTraders.getMarketplace("OE-PM-TR");
    let metalBuyPrice = market['location']['marketplace'].find((item: any) => { item.symbol == "METALS" })?.pricePerUnit || 10;
    // while(metalBuyPrice >=5) {
    //     console.log("Waiting for better buy price.");
    //     await delay(30 * 1000);
    //     market = await spaceTraders.getMarketplace("OE-PM-TR");
    //     metalBuyPrice = market.planet.marketplace.find((item) => { item.symbol == "METALS" })?.pricePerUnit || 10;
    // }

    await spaceTraders.sellGood(ship.id, "SHIP_PARTS", 19).then((sale: any)=>{
        console.log("Sold "+sale['order']['good']+" for: "+ sale['order']['total']);
    }, ()=>{});
    // await spaceTraders.purchaseGood(ship.id, "METALS", 98).then((purchaseRes: any)=>{
    //     console.log("Bought Metal for: "+ purchaseRes['order']['total']);
    // }, ()=>{});
    await spaceTraders.purchaseGood(ship.id, "FUEL", 2);

    await spaceTraders.createFlightPlan(ship.id, "OE-PM");
}

async function sellLoop(ship: YourShip) {
    let market: any = await spaceTraders.getMarketplace("OE-PM");
    let metalSellPrice = market['location']['marketplace'].find((item: any) => { item.symbol == "METALS" })?.pricePerUnit || 0;
    // while(metalSellPrice <= 5) {
    //     console.log("Waiting for better sell price.");
    //     await delay(30 * 1000);
    //     market = await spaceTraders.getMarketplace("OE-PM");
    //     metalSellPrice = market.planet.marketplace.find((item) => { item.symbol == "METALS" })?.pricePerUnit || 0;
    // }

    // await spaceTraders.sellGood(ship.id, "METALS", 98).then((sellRes: any)=>{
    //     console.log("Sold Metal for: "+sellRes['order']['total']);
    // }, ()=>{});
    await spaceTraders.purchaseGood(ship.id, "SHIP_PARTS", 19).then((sale: any)=>{
        console.log("Bought "+sale['order']['good']+" for: "+ sale['order']['total']);
    }, ()=>{});
    await spaceTraders.purchaseGood(ship.id, "FUEL", 4);

    await spaceTraders.createFlightPlan(ship.id, "OE-PM-TR");
}

main();

