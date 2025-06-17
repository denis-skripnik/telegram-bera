const pool = require('./@db.js')

async function getUser(id) {

	let client = await pool.getClient()
	if (!client) {
		return;
	}

	try {

		const db = client.db("my_bera_bot");

		let collection = db.collection('users');

        let res = await collection.findOne({id});

return res;
} catch (err) {

    console.log(err);
    return err;
} finally {

}
}

async function updateUser(data) {

	let client = await pool.getClient()
	if (!client) {
		return;
	}

	try {

		const db = client.db("my_bera_bot");

		let collection = db.collection('users');

      let res = await collection.updateOne({id: data.id}, {$set: data}, {upsert: true});

return res;

} catch (err) {

    console.log(err);
    return err;
} finally {

}
}

async function findAllUsers() {
    
	let client = await pool.getClient()
	if (!client) {
		return;
	}

	try {

		const db = client.db("my_bera_bot");

		let collection = db.collection('users');

      const res = [];
      let cursor = await collection.find({}).limit(500);
      let doc = null;
      while(null != (doc = await cursor.next())) {
          res.push(doc);
      }
  return res;
} catch (err) {

    console.log(err);
    return err;
} finally {

}
}

async function removeUser(id) {

	let client = await pool.getClient()
	if (!client) {
		return;
	}

	try {

		const db = client.db("my_bera_bot");

		let collection = db.collection('users');

		let res = await collection.deleteOne({
			id
		});

		return res;

	} catch (err) {

		console.log(err);
		return err;
	} finally {

	}
}

module.exports.getUser = getUser;
module.exports.updateUser = updateUser;
module.exports.removeUser = removeUser;
module.exports.findAllUsers = findAllUsers;