-- src/main.lua
-- Discworld Cowtography — mallard plugin.
--
-- Map panel: mirrors room.info GMCP frames to the map iframe.
-- Commands:
--   db <place>                search rooms by name
--   db npc [<{area}>] <name>  search NPCs, optionally filtered by area
--   db item <name>            search shop items
--   db shop <name>            alias for db item
--   db <number>               route to result N and start walking immediately
--   bm [add|rm|<name>]        list, add, remove, or route to bookmarks
--   go [clear]                start/resume the current route, or clear it
--
-- Data credit: Quow's Cow Bar and Minimap plugin — https://quow.co.uk/minimap.php
--
-- This file is a thin facade: it requires every cowtography.* module
-- exactly once and wires cross-module access via each module's init(deps)
-- function. This is deliberate, not stylistic: Mallard's plugin sandbox
-- require() has no caching (every call re-reads and re-executes the target
-- file from scratch - see mallard/src-tauri/src/plugins/sandbox.rs) and
-- caps a plugin's Lua VM at 32MB. A module required from more than one
-- place gets re-executed once per caller, recursively - so every
-- cowtography.* file must be required from exactly one place (here), and
-- receive whatever it needs from other cowtography.* modules as a plain
-- table passed to its own init(deps), never via its own require(). (This
-- used to matter even more when this plugin required ~90k lines of static
-- data.* tables at startup; that data now lives in the seeded SQLite db
-- and is queried via the `db` global instead — see state.lua and
-- search.lua.)

local MAX_DISPLAY = 10 -- pre-existing, unused since before this refactor; left as-is

local colors     = require('cowtography.colors')
local state      = require('cowtography.state')
local uu_library = require('cowtography.uu_library')
local panel      = require('cowtography.panel')
local shades     = require('cowtography.shades')
local medina     = require('cowtography.medina')
local walk       = require('cowtography.walk')
local prediction = require('cowtography.prediction')
local blorps     = require('cowtography.blorps')
local route      = require('cowtography.route')
local notes      = require('cowtography.notes')
local gmcp_handlers = require('cowtography.gmcp')
local commands   = require('cowtography.commands')

-- colors.lua and state.lua have no cross-module deps of their own, so no
-- init() call for either. Every other module's init() only stores
-- references and/or registers deferred closures - none of them invoke
-- another module's still-uninitialized state, so call order here doesn't
-- matter beyond "every require above has already completed."

uu_library.init({ room_exists = state.room_exists, colors = colors, panel = panel.panel })
panel.init({ state = state, uu_library = uu_library })
shades.init({ state = state, panel = panel })
medina.init({ state = state, panel = panel })
walk.init({ colors = colors, state = state, panel = panel })
prediction.init({ state = state, walk = walk, panel = panel.panel })
blorps.init({})
route.init({ colors = colors, state = state, panel = panel, walk = walk, blorps = blorps })
notes.init({ state = state, panel = panel, colors = colors, uu_library = uu_library })
gmcp_handlers.init({
  colors = colors, state = state, uu_library = uu_library, panel = panel,
  shades = shades, medina = medina, walk = walk, prediction = prediction, notes = notes,
})
commands.init({
  colors = colors, state = state, uu_library = uu_library, panel = panel,
  route = route, walk = walk, gmcp = gmcp_handlers, notes = notes,
})
