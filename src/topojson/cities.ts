import {pgClient} from "../pgClient";

const fs = require("fs");

const path = './topojson/cities';

const main = async (): Promise<void> => {

    const client = await pgClient();
    const sql = `
        with edges as (
            select gid as arc_id, geom, code from japan where code = $1 and ST_Area(geom) > 0.0003495285322129
        ),
             collect_edges as (
                 select st_collect(geom) as geom, code
                 from edges
                 group by code
             ),
             bbox_info as (
                 select code,
                        st_xmin(geom)  as x0,
                        st_xmax(geom)  as x1,
                        st_ymin(geom)  as y0,
                        st_ymax(geom)  as y1,
                        case
                            when st_xmax(geom) - st_xmin(geom) > 0 then (10000 - 1) / (st_xmax(geom) - st_xmin(geom))
                            else 1 end as kx,
                        case
                            when st_ymax(geom) - st_ymin(geom) > 0 then (10000 - 1) / (st_ymax(geom) - st_ymin(geom))
                            else 1 end as ky
                 from collect_edges
             ),
             dump_points as (
                 select arc_id,
                        (st_dumppoints(geom)).*,
            (select x0 from bbox_info) as x0,
            (select y0 from bbox_info) as y0,
            (select kx from bbox_info) as kx,
            (select ky from bbox_info) as ky
        from
            edges
            ), quantize as (
        select
            arc_id,
            path,
            geom,
            round((st_x(geom) - x0) * kx) as x,
            round((st_y(geom) - y0) * ky) as y
        from
            dump_points
            ), delta as (
        select
            q1.arc_id,
            q1.path as path1,
            q2.path as path2,
            case when q2.path is null then q1.x else q1.x - q2.x end as x,
            case when q2.path is null then q1.y else q1.y - q2.y end as y
        from quantize as q1 left outer join quantize q2
        on ( q1.arc_id = q2.arc_id and q1.path[2] = q2.path[2]+1 )
        order by q1.arc_id, q1.path
            ), delta_arc_ids as (
        select arc_id
        from delta
        group by arc_id
        order by arc_id
            ), delta_arc_no as (
        select row_number() over (order by arc_id) as idx
        from delta_arc_ids
            ), delta_arc_no_ary as (
        select array_agg('[' || idx - 1 || ']') as ary
        from delta_arc_no
            ), arcs as (
        select array_to_string(array_agg( '[' || x || ',' || y || ']'), ',') as a
        from delta
        group by arc_id
            ), topojson as (
        select '{ "type": "Topology", "transform": { "scale": [' || to_char(1 / kx, '0.999999999999999') || ',' || to_char(1 / ky, '0.999999999999999') || '], "translate": [' || x0 || ',' || y0 || '] }, "objects": { "' || code || '": ' as json
        from bbox_info
        union all
        select '{ "type": "GeometryCollection", "geometries": [{ "type": "MultiPolygon", "arcs": [[' || array_to_string(ary, ',') || ']]}]}' as json
        from delta_arc_no_ary
        union all
        select '}, "arcs": [' as json
        union all
        select array_to_string(array_agg('[' || a || ']'), ',') as json
        from arcs
        union all
        select ']}' as json
            )
        select string_agg(json, '') as topojson
        from topojson;
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
        fs.writeFileSync(`${filepath}/${city.code}.topojson`, JSON.stringify(JSON.parse(json.rows[0].topojson)));
    }
    await client.end()
}

main().then(() => {
    console.log("cities.ts finished");
});