// // Seeds N fake tickets into the database via the call-ticket endpoint
// // (doesn't need a live IMAP/email connection, unlike email ingest).
// // Run with:  k6 run --vus 5 --iterations 500 seed-tickets.js
// //   --iterations = total tickets to create
// //   --vus        = how many parallel "workers" creating them (keep modest)

// import http from 'k6/http';
// import { check } from 'k6';

// const BASE_URL = 'http://localhost:4000';

// export const options = {
//   // Override on the command line with --vus / --iterations as needed.
//   vus: 5,
//   iterations: 500,
// };

// export default function () {
//   // Unique callId per ticket so none get deduped/skipped.
//   const callId = `loadtest-${Date.now()}-${__VU}-${__ITER}-${Math.random().toString(36).slice(2)}`;

//   const payload = JSON.stringify({
//     callerNumber: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
//     agentId: 'loadtest-agent',
//     description: 'Synthetic ticket created for capacity/load testing.',
//     category: 'GENERAL',
//     urgency: ['LOW', 'MEDIUM', 'HIGH'][Math.floor(Math.random() * 3)],
//     customerName: `Test Customer ${__ITER}`,
//     customerEmail: `loadtest${__ITER}@example.com`,
//   });

//   const res = http.post(`${BASE_URL}/api/calls/${callId}/create-ticket`, payload, {
//     headers: { 'Content-Type': 'application/json' },
//   });

//   check(res, { 'ticket created: status 200': (r) => r.status === 200 });
// }
// Seeds N fake tickets into the database via the call-ticket endpoint
// (doesn't need a live IMAP/email connection, unlike email ingest).
// Run with:  k6 run --vus 5 --iterations 500 seed-tickets.js
//   --iterations = total tickets to create
//   --vus        = how many parallel "workers" creating them (keep modest)

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = 'http://localhost:4000';

export const options = {
  // Override on the command line with --vus / --iterations as needed.
  vus: 5,
  iterations: 500,
};

export default function () {
  // Unique callId per ticket so none get deduped/skipped.
  const callId = `loadtest-${Date.now()}-${__VU}-${__ITER}-${Math.random().toString(36).slice(2)}`;

  const payload = JSON.stringify({
    callerNumber: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
    agentId: 'loadtest-agent',
    description: 'Synthetic ticket created for capacity/load testing.',
    category: 'GENERAL',
    urgency: ['LOW', 'MEDIUM', 'HIGH'][Math.floor(Math.random() * 3)],
    customerName: `Test Customer ${__ITER}`,
    customerEmail: `loadtest${__ITER}@example.com`,
  });

  const res = http.post(`${BASE_URL}/api/calls/${callId}/create-ticket`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  const ok = check(res, { 'ticket created: status 200': (r) => r.status === 200 });

  // Print the actual error the FIRST few times it fails, so we can see
  // why — after that, stay quiet so the log isn't flooded.
  if (!ok && __ITER < 3) {
    console.log(`FAILED — status ${res.status}, body: ${res.body}`);
  }
}