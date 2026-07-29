-- src/cowtography/walk.lua
-- Walk state shared by /go, /db, and /bm — either can create a route, and
-- /go walks it.

local M = {}

-- injected via M.init()
local state  -- cowtography.state module
local panel  -- cowtography.panel module
local C, note -- colors.C, colors.note

local route_to_room -- injected via M.set_router(); used by walk_paused's recalculate branch

function M.set_router(fn)
  route_to_room = fn
end

local walk_steps        = {}
local walk_pos           = 0
local walk_target_name   = ''
local walk_target_id     = nil -- destination room id, for auto-reroute if a pause lands us off-route
local walk_rooms         = {}  -- expected room id at each step (parallels walk_steps, one longer)
local walk_last_progress = 0   -- os.time() of the last confirmed step, for the stall watchdog

function M.get_pos() return walk_pos end
function M.get_steps_count() return #walk_steps end

-- Sets a freshly computed route and resets walk_pos to 0 (not yet walking) —
-- mirrors route_to_room's own unconditional walk_pos assignment in the
-- original code, whichever branch (immediate or deferred) it took.
function M.set_route(steps, rooms, target_name, target_id)
  walk_steps       = steps
  walk_rooms       = rooms
  walk_target_name = target_name
  walk_target_id   = target_id
  walk_pos         = 0
end

function M.reset_state()
  walk_steps       = {}
  walk_pos         = 0
  walk_target_name = ''
  walk_rooms       = {}
  walk_target_id   = nil
end

-- Used by reset_walk() (still in main.lua pending the gmcp.lua extraction),
-- which also needs to clear the predicted-target overlay.
function M.reset_for_disconnect()
  M.reset_state()
  panel.post_route_clear()
end

function M.arrived(name)
  note(string.format('  Arrived at "%s".', name), C.ok)
  walk_steps = {}; walk_pos = 0; walk_target_name = ''
  walk_rooms = {}; walk_target_id = nil
  panel.post_route_clear()
  local snd = settings.get('walk_sound')
  if snd and snd ~= 'none' then mud.play_sound(snd) end
end

-- Called once per room.info confirmation (identified room or dark room) when
-- a walk is in progress. The original GMCP handler duplicated this block
-- verbatim at both call sites; this is the single shared copy.
function M.advance_or_arrive()
  if walk_pos > 0 then
    walk_last_progress = os.time()
    if walk_pos < #walk_steps then
      walk_pos = walk_pos + 1
      local remaining = #walk_steps - walk_pos + 1
      note(string.format('  %d move%s remaining.', remaining, remaining == 1 and '' or 's'), C.muted)
    else
      M.arrived(walk_target_name)
    end
  end
end

-- Discworld queues commands sent while a movement queue is active, so the
-- verbose look fires as soon as the queued moves actually finish.
-- Fixed name, redefined (overwritten) on every walk — M.walk() already
-- guards against two walks running at once, so nothing else can be mid-
-- invocation of this alias when it's redefined.
local WALK_ALIAS_NAME = 'CowtographyWalk'

local function send_walk_steps()
  -- Sending each step as its own top-level command hit an internal
  -- Discworld command-queue cap around ~60-64 no matter how it was
  -- delivered: one mud.send() per step, or one call with the steps '\r\n'-
  -- joined into a single line (which correctly reads as separate commands
  -- to Discworld, ruling out this being only Mallard's bounded-channel
  -- bug — that fix stayed, this cap is Discworld's own). Its alias system
  -- doesn't share that cap: the identical route walked to completion in
  -- MUSHclient using Quow's plugin, which defines the whole route as a
  -- server-side alias and invokes it, rather than submitting the steps as
  -- top-level commands. ';' is only meaningful to Discworld as a separator
  -- *inside* an alias body (confirmed in-game — raw ';'-joined input isn't
  -- split at all), which is exactly this context.
  local parts = {}
  if settings.get('brief_verbose_look') then parts[#parts + 1] = 'brief look' end
  for _, step in ipairs(walk_steps) do parts[#parts + 1] = step end
  if settings.get('brief_verbose_look') then parts[#parts + 1] = 'verbose look' end
  mud.send('alias ' .. WALK_ALIAS_NAME .. ' ' .. table.concat(parts, ';'), { silent = true })
  mud.send(WALK_ALIAS_NAME, { silent = true })
end
M.send_walk_steps = send_walk_steps

function M.walk()
  local p = mud.command_prefix()
  if #walk_steps == 0 then
    note(string.format('  No route set. Run "%sdb <number>" or "%sbm <name>" first.', p, p), C.err)
    return
  end
  if walk_pos > 0 then
    note('  Already walking.', C.muted)
    return
  end
  walk_pos = 1
  walk_last_progress = os.time()
  note(string.format('  Walking to "%s" — %d move%s.', walk_target_name, #walk_steps, #walk_steps == 1 and '' or 's'), C.ok)
  send_walk_steps()
  panel.panel:post("walk_active", {})
end

function M.clear_route()
  M.reset_state()
  panel.post_route_clear()
  note('  Route cleared.', C.muted)
end

-- Discworld can clear a queued walk without printing any recognizable text,
-- so a stalled walk is detected either by that message or by the watchdog
-- further down. Both funnel here: keep the untraveled remainder of the route
-- instead of discarding it, so a plain /go resumes rather than forcing a
-- fresh /db or /bm.
local function walk_paused(reason)
  if walk_pos == 0 then return end
  local at_pos         = walk_pos
  local dest_id        = walk_target_id
  local dest_name      = walk_target_name
  local expected_room  = walk_rooms[at_pos]
  walk_pos = 0

  if expected_room and state.current_room and state.current_room ~= expected_room then
    -- We ended up somewhere the route didn't expect (dragged, teleported,
    -- portal, etc.) — the remaining directions are no longer valid.
    walk_steps = {}; walk_rooms = {}; walk_target_id = nil
    panel.post_route_clear()
    note(string.format('  %s Position no longer matches the route — recalculating.', reason), C.header)
    route_to_room(dest_id, dest_name, false)
    return
  end

  walk_steps = { table.unpack(walk_steps, at_pos, #walk_steps) }
  walk_rooms = { table.unpack(walk_rooms, at_pos, #walk_rooms) }
  local remaining = #walk_steps
  panel.post_route(walk_rooms, dest_name, remaining)
  local p = mud.command_prefix()
  mud.note(mud.span(string.format('  %s %d move%s remaining to "%s". Type ', reason, remaining, remaining == 1 and '' or 's', dest_name), { fg = C.header })
        .. mud.span(p .. 'go', { fg = C.header, on_click = function() M.walk() end })
        .. mud.span('.', { fg = C.header }))
end
M.paused = walk_paused

function M.init(deps)
  state = deps.state
  panel = deps.panel
  C, note = deps.colors.C, deps.colors.note

  panel.panel:on_message("walk_request", function(_frame)
    M.walk()
  end)

  panel.panel:on_message("clear_request", function(_frame)
    M.clear_route()
  end)
end

mud.trigger([[^(?:> )?Removed queue\.$]], function()
  walk_paused('Movement queue was cleared.')
end)

-- Fallback for interruptions that clear the queue without printing anything
-- the trigger above can match. Empirically, room arrivals during a normal
-- walk land 0-2s apart; 5s of silence mid-route means the queue emptied
-- unnoticed.
local WALK_STALL_SECONDS = 5
mud.every(1000, function()
  if walk_pos > 0 and os.time() - walk_last_progress >= WALK_STALL_SECONDS then
    walk_paused(string.format('No movement for %ds — you may have been interrupted.', WALK_STALL_SECONDS))
  end
end)

return M
