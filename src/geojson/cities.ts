import {pgClient} from "../pgClient";

const fs = require("fs");

const path = './geojson/cities';

const main = async (): Promise<void> => {

    const client = await pgClient();
    const sql = `
SELECT json_build_object(
    'type', 'FeatureCollection',
    'features', json_agg(ST_AsGeoJSON(pref.*)::json)
    )
FROM (
	select
		code as id, ST_Union(geom)
	from
		japan
	where
	    code = $1
    and
        ST_Area(geom) > 0.0003495285322129
	group by
		code
) as pref;
`;
    const cities = await client.query("select code, pref, regional, city1, city2, count(*) as cnt from japan where ST_Area(geom) > 0.0003495285322129 group by code, pref, regional, city1, city2 order by code");

    for (let i in cities.rows) {
        const city = cities.rows[i];
        const json = await client.query(sql, [city.code]);
        if (!city.code) {
            console.log("所属未定地");
            break;
        }
        const prefCode = city.code.substring(0, 2);
        const filepath = `${path}/${prefCode}`;
        if (!fs.existsSync(filepath)) {
            fs.mkdirSync(filepath, {recursive: true});
        }
        console.log(city.code, city.pref, city.regional, city.city1, city.city2, city.cnt);
        fs.writeFileSync(`${filepath}/${city.code}.json`, JSON.stringify(json.rows[0].json_build_object));
    }
    await client.end()
}

main().then(() => {
    console.log("cities.ts finished");
});