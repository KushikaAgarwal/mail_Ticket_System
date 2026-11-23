// Measures how fast the ticket list/detail endpoints respond, at
// whatever current ticket volume is in the database right now.
// Run this BETWEEN rounds of seed-tickets.js to see how performance
// changes as the ticket count grows (e.g. measure at 100, then seed
// up to 1,000, measure again, seed up to 10,000, measure again...).
//
// Run with:  k6 run measure.js

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = 'http://localhost:4000';

export const options = {
  vus: 3,          // a few parallel readers, since it's a single admin
  duration: '20s',
};

export default function () {
  const listRes = http.get(`${BASE_URL}/api/tickets`);
  check(listRes, {
    'list: status 200': (r) => r.status === 200,
    'list: under 1s': (r) => r.timings.duration < 1000,
  });

  try {
    const body = JSON.parse(listRes.body);
    console.log(`Current ticket count in list response: ${body.tickets ? body.tickets.length : 'unknown'}`);

    if (body.tickets && body.tickets.length > 0) {
      const randomTicket = body.tickets[Math.floor(Math.random() * body.tickets.length)];
      const detailRes = http.get(`${BASE_URL}/api/tickets/${randomTicket.id}`);
      check(detailRes, {
        'detail: status 200': (r) => r.status === 200,
        'detail: under 1s': (r) => r.timings.duration < 1000,
      });
    }
  } catch (e) {
    console.log('Could not parse tickets response');
  }

  sleep(1);
}