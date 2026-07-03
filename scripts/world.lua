-- Lightweight shared registry of live tanks.
--
-- With `shared_state = 1` (see game.project) every script instance shares one
-- Lua state, so this module is a single global table. Projectiles use it for
-- collision/damage resolution instead of the physics engine, which keeps the
-- MVP self-contained and deterministic.

local M = {}

M.tanks = {}   -- key -> { url = <url>, team = <string>, radius = <number> }

function M.register(key, data)
    M.tanks[key] = data
end

function M.unregister(key)
    M.tanks[key] = nil
end

-- Return the nearest live tank NOT on `team` within `range` of `pos`,
-- or nil. Skips tanks whose game object has already been deleted.
function M.nearest_enemy(pos, team, range)
    local best, best_d = nil, range or math.huge
    for _, t in pairs(M.tanks) do
        if t.team ~= team then
            local ok, tpos = pcall(go.get_position, t.url)
            if ok then
                local d = vmath.length(tpos - pos)
                if d < best_d then
                    best, best_d = t, d
                end
            end
        end
    end
    return best, best_d
end

-- Find the first live enemy tank overlapping a sphere of `radius` at `pos`.
function M.hit_test(pos, team, radius)
    for _, t in pairs(M.tanks) do
        if t.team ~= team then
            local ok, tpos = pcall(go.get_position, t.url)
            if ok then
                if vmath.length(tpos - pos) < (radius + (t.radius or 1.5)) then
                    return t
                end
            end
        end
    end
    return nil
end

return M
