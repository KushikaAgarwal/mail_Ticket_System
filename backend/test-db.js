const { Pool } = require('pg');

const p = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'flowable',
  user: 'flowable',
  password: 'flowable',
});

p.query('SELECT current_database(), current_user, version()')
  .then((r) => {
    console.log('CONNECTION INFO:', r.rows);
    return p.query('SELECT COUNT(*) FROM public.tickets');
  })
  .then((r) => console.log('tickets count:', r.rows))
  .catch((e) => console.error('ERR:', e.message))
  .finally(() => p.end());