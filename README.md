# SpaceTradersScript
* Edit login credentials with your own credentials.  See SpaceTraders.io for how to register an account.  Keep ahold of your token
* Install packages with `npm i`
* run script using either:
** `ts-node src/index.ts` to run the script without cold reloading
** `nodemon` to run the script with cold reloading, this will rerun the script every time it is saved.  Beware the loop will restart.

What this does (currently):

* This is an infinite loop.
* Polls your account, and grabs your ship list (You will need to have a ship, play with the APIs on your own to get to this point)
* Once you have at least 1 ship, the script will move the ship from location to location, looking for the best trade good values.  If it cant find any, it will move on.
* Has a data object `shipToBuy` near the top.  Once a certain threshold of credits is accrued, this will automatically buy a new ship, of the corresponding type, up to the set limit.  

TODO:
* Smarten up the loop, calculate profit gained - Partially DONE
* Add sequential looping for multiple ships - DONE
* Dynamic trade routes - DONE

Things to keep in mind:
* Game is an MMO, markets are affected by all those playing
* Game has a hard 2-requests per second lock out rate.  More requests than that will cause requests to fail.
