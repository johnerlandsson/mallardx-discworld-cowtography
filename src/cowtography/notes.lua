-- src/cowtography/notes.lua
-- Per-character room notes: one free-text note per room, added/edited via the
-- map panel's right-click menu or the /note command, surfaced via a
-- hyperlinked message when walking into a noted room.

local M = {}

-- injected via M.init()
local state, panel, colors, uu_library
local C, note

function M.init(deps)
  state, panel, colors, uu_library = deps.state, deps.panel, deps.colors, deps.uu_library
  C, note = colors.C, colors.note

  panel.panel:on_message("ready", function()
    M.push_panel()
  end)

  panel.panel:on_message("note_save", function(frame)
    local ok, err = M.set(frame.roomId, frame.text)
    if not ok then
      note('  ' .. err, C.err)
      return
    end
    M.push_panel()
  end)

  panel.panel:on_message("note_remove", function(frame)
    M.remove(frame.roomId)
    M.push_panel()
  end)
end

function M.push_panel()
  panel.panel:post("notes_data", { notes = M.all() })
end

local function note_key()
  return state.char_name and ('note_' .. state.char_name) or 'notes'
end

local function load_notes()
  local t = storage.get(note_key())
  return type(t) == 'table' and t or {}
end

local function save_notes(t)
  storage.set(note_key(), t)
end

function M.all()
  return load_notes()
end

function M.get(room_id)
  if room_id == nil then return nil end
  return load_notes()[room_id]
end

-- Returns true on success, or false + an error message when room_id isn't a
-- real database room (subsystem placeholders like "AMShades"/"BPMedina",
-- hand-annotated map elements, etc. all fail this the same way).
function M.set(room_id, text)
  if not state.room_exists(room_id) then
    return false, "Can't add a note here — not a trackable room."
  end
  local notes = load_notes()
  notes[room_id] = text
  save_notes(notes)
  return true
end

function M.remove(room_id)
  local notes = load_notes()
  notes[room_id] = nil
  save_notes(notes)
end

-- Resolves the /note command's target room. Unlike M.set (used directly for
-- an explicit right-click target), this also rejects darkness and the
-- library/L-space, both of which leave state.current_room pointing at a
-- stale-but-validly-hashed room id instead of the room the player is
-- actually standing in.
function M.check_current_room(action)
  if state.current_room == nil then
    return nil, 'Current room unknown. Move through a mapped room first.'
  end
  if state.in_dark then
    return nil, string.format("Can't %s while it's dark.", action)
  end
  if uu_library.is_in_library() or uu_library.is_in_lspace() then
    return nil, string.format("Can't %s in the library.", action)
  end
  return state.current_room
end

return M
