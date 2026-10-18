import test from "node:test";
import assert from "node:assert/strict";
import {tradeBuyPrice} from "./trade-posts.js";

test("fixed buy trigger uses the chosen coin price",()=>{
 assert.equal(tradeBuyPrice("price",95000,100000),95000);
});
test("percentage trigger is fixed from the saved current BIN",()=>{
 assert.equal(tradeBuyPrice("drop_pct",5,100000),95000);
 assert.equal(tradeBuyPrice("drop_pct",3,99999),96999);
});
test("invalid trigger values are rejected",()=>{
 assert.throws(()=>tradeBuyPrice("drop_pct",51,100000));
 assert.throws(()=>tradeBuyPrice("drop_pct",2.5,100000));
 assert.throws(()=>tradeBuyPrice("price",500,100000));
});
