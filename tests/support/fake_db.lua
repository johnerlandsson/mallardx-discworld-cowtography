-- tests/support/fake_db.lua
-- Minimal stand-in for Mallard's `db` global (see docs/plugin-db-api.md in
-- the Mallard repo), backed by LuaSQL's sqlite3 driver against an
-- in-memory database. Only implements what Cowtography's Lua code calls:
-- db.query(sql, params) and db.exec(sql, params). Positional `?`
-- placeholders are substituted client-side before handing the SQL to
-- LuaSQL (its execute() takes a raw string, no native bind API) — fine
-- for a test-only shim; the real parameter-binding path is Mallard's own
-- Rust code and isn't what these tests exercise.
local luasql = require('luasql.sqlite3')

local M = {}

local function quote(v)
  if v == nil then return 'NULL' end
  if type(v) == 'number' then return tostring(v) end
  if type(v) == 'boolean' then return v and '1' or '0' end
  return "'" .. tostring(v):gsub("'", "''") .. "'"
end

local function bind(sql, params)
  if not params then return sql end
  local i = 0
  return (sql:gsub('%?', function()
    i = i + 1
    return quote(params[i])
  end))
end

function M.new()
  local env  = luasql.sqlite3()
  local conn = env:connect(':memory:')

  local db = {}

  function db.exec(sql, params)
    local res, err = conn:execute(bind(sql, params))
    if res == nil then error(err, 2) end
    if type(res) == 'number' then return res end
    res:close()
    return 0
  end

  function db.query(sql, params)
    local cur, err = conn:execute(bind(sql, params))
    if cur == nil then error(err, 2) end
    if type(cur) == 'number' then
      error('query did not return rows (not a SELECT?)', 2)
    end
    local rows = {}
    local row = cur:fetch({}, 'a')
    while row do
      rows[#rows + 1] = row
      row = cur:fetch({}, 'a')
    end
    cur:close()
    return rows
  end

  return db
end

return M
