-- Exercise the real route and panel modules through the cross-plugin event API.
package.path = './src/?.lua;' .. package.path
package.loaded.search = {}
package.loaded['data.maps'] = {}
local listeners, emitted, panels = {}, {}, {}
events = {
  on = function(name, callback) listeners[name] = callback end,
  emit = function(name, data) emitted[name] = data end,
}
storage = {get = function() end}
settings = {get = function() end}
vars = {set = function() end}
mud = {panel = function(id)
  local panel = {callbacks = {}, posts = {}}
  function panel:on_message(name, callback) self.callbacks[name] = callback end
  function panel:post(name, data) self.posts[#self.posts + 1] = {name = name, data = data} end
  panels[id] = panel
  return panel
end}
local state = {current_room = 'A', exits = {A={B='n'}, B={C='e'}, C={}}}
local panel = require('cowtography.panel')
panel.init({state=state, uu_library={is_in_lspace=function() return false end, is_in_library=function() return false end}})
local reset_count = 0
local walk = {set_router=function() end, reset_state=function() reset_count=reset_count+1 end}
require('cowtography.route').init({state=state, panel=panel, walk=walk, colors={C={}}})
local function last_post() return panels.map.posts[#panels.map.posts] end
local request = listeners['cowtography:bp_route']
request({request=1, rooms={{id='C'}, {id='unreachable'}}})
assert(last_post().name == 'route_set')
assert(table.concat(last_post().data.rooms, ',') == 'A,B,C')
assert(last_post().data.color == '#4ade80' and last_post().data.visual_only == true)
assert(emitted['bproute:map_result'].request == 1)
assert(emitted['bproute:map_result'].stops == 1 and emitted['bproute:map_result'].moves == 2)
assert(emitted['bproute:map_result'].skipped == 1 and reset_count == 1)
-- Reopening the panel restores its color and visual-only behavior.
panels.map.callbacks.ready()
assert(last_post().data.color == '#4ade80' and last_post().data.visual_only == true)
-- Clearing works even when no current location is known.
state.current_room = nil
request({request=2, clear=true})
assert(last_post().name == 'route_clear' and reset_count == 2)
assert(emitted['bproute:map_result'].request == 2 and emitted['bproute:map_result'].cleared)
local post_count = #panels.map.posts
panels.map.callbacks.ready()
for i = post_count+1, #panels.map.posts do assert(panels.map.posts[i].name ~= 'route_set') end
request({request=3, rooms={{id='C'}}})
assert(emitted['bproute:map_result'].error and emitted['bproute:map_result'].request == 3)
state.current_room = 'A'
request({request=4, rooms={{id='unreachable'}}})
assert(last_post().name == 'route_clear' and emitted['bproute:map_result'].error)
-- Ordinary destination routes restore their standard color and Walk button.
panel.post_route({'A','B'}, 'B', 1)
assert(last_post().data.color == nil and last_post().data.visual_only == nil)
panels.map.callbacks.ready()
assert(last_post().data.color == nil and last_post().data.visual_only == nil)
print('PASS: BP route events, clear, errors, panel replay, and ordinary routes')
