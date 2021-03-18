# SpaceTradersScript
* Edit login credentials with your own credentials.  See SpaceTraders.io for how to register an account.  Keep ahold of your token
* Install packages with `npm i`
* run script using either:
** `ts-node src/index.ts` to run the script without cold reloading
** `nodemon` to run the script with cold reloading, this will rerun the script every time it is saved.  Beware the loop will restart.

What this does (currently):

* This is an infinite loop.
* Polls your account, and grabs your first ship (You will need to have a ship, play with the APIs on your own to get to this point)
* Currently, loops that ship between locations "OE-PM" and "OE-PM-TR" and buys then sells "SHIP_PARTS", which is a near guaranteed profit.

TODO:
* Smarten up the loop, calculate profit gained.
* Add sequential looping for multiple ships
* Dynamic trade routes?

Things to keep in mind:
* Game is an MMO, markets are affected by all those playing
* Game has a hard 2-requests per second lock out rate.  More requests than that will cause requests to fail.
