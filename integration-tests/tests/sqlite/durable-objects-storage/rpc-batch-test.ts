import { Storage } from './miniflare';

{
  const client = Storage('test')

  client.sql.exec(`create table if not exists users (
    id integer primary key autoincrement, 
    name text
  )`);
  
  try {
      const insertResponse = client.sql.exec(`
        insert into users (name) values (?) returning id
      `, ['John']);

      const insertResponse2 = client.sql.exec(`
        insert into users (name) values (?) returning id
      `, insertResponse.map(r => r.id));

      const insertResponse3 = client.sql.exec(`
        insert into users (name) values (?) returning id
      `, insertResponse2.map(r => r.id));
  
      const johnSelected = await client.sql.exec(`
        select * from users where id = ?
      `, insertResponse3.map(r => r.id));

      await insertResponse2;
      console.log(johnSelected);
      
  } catch(e) {
    console.error(e);
  }

}
const client = Storage('test')
const users = await client.sql.exec(`
  select * from users
`);
console.log(users);

client[Symbol.dispose]();
