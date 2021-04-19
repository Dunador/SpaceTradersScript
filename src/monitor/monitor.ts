import * as blessed from 'blessed';
import * as _ from 'lodash';
import { User } from 'spacetraders-sdk/dist/types';
import { LoadedShip } from '../types';

let screen = blessed.screen({
  smartCSR: true,
});

screen.title = 'Space Trader Monitor';

// let consoleBox = blessed.box({
//   top: 0,
//   left: 0,
//   padding: 2,
//   height: '50%',
//   width: '100%',
//   keys: true,
//   mouse: true,
//   alwaysScroll: true,
//   scrollable: true,
//   border: 'line',
//   scrollbar: {
//     style: {
//       ch: ' ',
//       bg: 'red'
//     }
//   }
// });

// screen.append(consoleBox);

let table = blessed.listtable({
  bottom: 0,
  left: 0,
  height: '100%',
  width: '100%',
  align: 'center',
  border: 'line',
  alwaysScroll: true,
  scrollable: true,
  scrollbar: {
    style: {
      fg: 'orange',
      bg: 'yellow'
    },
  },
  keys: true,
});

screen.append(table);

screen.key(['escape', 'q', 'C-c'], function(ch, key) {
  return process.exit(0);
});

export function generateDisplay(ships: LoadedShip[], user: User) {

  let data = [['Credits ' + user.credits, '', '', '', ''], ['Ship ID', 'Ship Type', 'Location', 'Cargo Space', 'Cargo Items']];
  data = data.concat(generateData(ships));
  table.setData(data);
  table.focus();
  screen.render();
}

function generateData(ships: LoadedShip[]) {
  const orderedShips = _.sortBy(ships, ['ships.id']);

  let data: string[][] = [];
  for (const ship of orderedShips) {
    data.push([
      ship.ship.id, 
      ship.ship.type, 
      ship.ship.location || 'In Transit', 
      (ship.ship.maxCargo - ship.ship.spaceAvailable)+'/'+ship.ship.maxCargo,
      ship.ship.cargo.map(item => item.good+' x '+item.quantity).filter(item => item).join(', '),
    ]);
  }

  data = _.orderBy(data, (item) => {
    return item[2];
  });

  return data;
}

export function log(output: string) {
  // consoleBox.pushLine(output);
  screen.render();
}