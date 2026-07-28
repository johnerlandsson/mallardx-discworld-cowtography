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
-- This file is a thin facade: it requires the cowtography.* modules (each a
-- focused piece of the original monolith) in dependency order and wires the
-- few cross-module init() calls that can't be expressed as plain requires.
-- All commands, aliases, triggers, and GMCP handlers are registered as a
-- side effect of requiring cowtography.commands/gmcp/route/walk/prediction
-- below — see each module for its own responsibility.

local MAX_DISPLAY = 10 -- pre-existing, unused since before this refactor; left as-is

local panel_mod = require('cowtography.panel')

local shades = require('cowtography.shades')
shades.init(panel_mod)

local medina = require('cowtography.medina')
medina.init(panel_mod)

require('cowtography.walk')

local prediction = require('cowtography.prediction')
prediction.init(panel_mod.panel)

require('cowtography.route')
require('cowtography.gmcp')
require('cowtography.commands')
