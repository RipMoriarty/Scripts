--[[
    Nullscape GUI  |  by Rip_Moriarty
    - custom GUI (no Rayfield)
    - auto collect gifts with smart mine avoidance (route planning, never teleports through/into mines)
    - god mode (destroys enemies / hazards on your client)
    - auto pick altars during intermission, with per-item counts (Picks tab)
    - auto go to beacon when requirements are done

    Hotkeys (ignored while typing):
      RightShift = show/hide GUI
      Z collect | X god | C auto pick | V beacon | B copy debug info | P stop
]]

local __ok, __err = xpcall(function()

if not game:IsLoaded() then game.Loaded:Wait() end

local env = (getgenv and getgenv()) or _G
if env.NullscapeGuiStop then pcall(env.NullscapeGuiStop) end
if env.NullAutoStop then pcall(env.NullAutoStop) end

------------------------------------------------------------------ services
local Players = game:GetService("Players")
local RS = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local StarterGui = game:GetService("StarterGui")
local UIS = game:GetService("UserInputService")
local HttpService = game:GetService("HttpService")

local plr = Players.LocalPlayer

------------------------------------------------------------------ settings
local CFG = {
    collect = true,
    god = true,
    choose = true,
    beacon = true,
    collectAll = false,
    speed = 120,
    mineMargin = 4,       -- extra safety distance around every mine
    predict = true,       -- inflate zones of moving mines by their speed
    lookahead = 1.5,      -- seconds of movement to predict
    magnet = 5,           -- gift collection range added at round start (0 = off), like the old GUI
    avoidEnemies = false, -- treat enemies as obstacles when god mode is OFF
    showZones = false,    -- draw mine danger zones
    beaconWaitPassage = true,
    noNeedGrace = 25,
    debug = true,
}

-- per intermission type: how many picks per break, and what/how many to pick
-- entries are matched (plain text, lowercase) against the altar text; max = 0 means unlimited
local PICKS = {
    ENEMIES  = { perBreak = 1, any = false, avoid = "", entries = {} },
    CURSES   = { perBreak = 1, any = false, avoid = "", entries = {} },
    UPGRADES = { perBreak = 1, any = false, avoid = "", entries = {} },
}
local TYPE_TITLES = {
    ENEMIES = "Enemies (intermission)",
    CURSES = "Curses (intermission)",
    UPGRADES = "Upgrades (intermission)",
}
local TYPE_ORDER = { "ENEMIES", "CURSES", "UPGRADES" }

local running = true
local conns = {}
local state = { action = "idle" }
local diag = { total = 0, withCollect = 0, visits = 0, collected = 0, failed = 0, unsafe = 0, noRoute = 0, countAt = 0, log = {} }

local function logEvent(text)
    local log = diag.log
    local stamp = os.date("%H:%M:%S")
    if log[#log] and log[#log]:sub(10) == text then return end
    log[#log + 1] = stamp .. " " .. text
    while #log > 7 do table.remove(log, 1) end
end
local breakPicks = { ENEMIES = 0, CURSES = 0, UPGRADES = 0 }
local UI = {}  -- filled by the GUI builder (refresh hooks)

------------------------------------------------------------------ save / load
local SAVE_FILE = "NullscapeGUI.json"
local SAVED_CFG_KEYS = { "collectAll", "speed", "mineMargin", "predict", "lookahead",
    "avoidEnemies", "beaconWaitPassage", "magnet" }

local function serialize()
    local t = { v = 4, cfg = {}, picks = {} }
    for _, k in ipairs(SAVED_CFG_KEYS) do t.cfg[k] = CFG[k] end
    for typ, p in pairs(PICKS) do
        local es = {}
        for _, e in ipairs(p.entries) do es[#es + 1] = { text = e.text, max = e.max } end
        t.picks[typ] = { perBreak = p.perBreak, any = p.any, avoid = p.avoid, entries = es }
    end
    return HttpService:JSONEncode(t)
end

local saveQueued = false
local function saveSoon()
    if saveQueued or not writefile then return end
    saveQueued = true
    task.delay(1, function()
        saveQueued = false
        pcall(function() writefile(SAVE_FILE, serialize()) end)
    end)
end

local function loadSaved()
    if not (isfile and readfile) then return end
    local ok, data = pcall(function()
        if not isfile(SAVE_FILE) then return nil end
        return HttpService:JSONDecode(readfile(SAVE_FILE))
    end)
    if not ok or type(data) ~= "table" then return end
    if data.v == 4 and type(data.cfg) == "table" then
        for _, k in ipairs(SAVED_CFG_KEYS) do
            if data.cfg[k] ~= nil and type(data.cfg[k]) == type(CFG[k]) then CFG[k] = data.cfg[k] end
        end
    end
    if type(data.picks) == "table" then
        for typ, p in pairs(PICKS) do
            local d = data.picks[typ]
            if type(d) == "table" then
                p.perBreak = tonumber(d.perBreak) or p.perBreak
                p.any = d.any == true
                p.avoid = type(d.avoid) == "string" and d.avoid or ""
                p.entries = {}
                for _, e in ipairs(d.entries or {}) do
                    if type(e.text) == "string" and e.text ~= "" then
                        p.entries[#p.entries + 1] = { text = e.text, max = tonumber(e.max) or 1, used = 0 }
                    end
                end
            end
        end
    end
end
pcall(loadSaved)

local function notify(text)
    print("[NullscapeGUI] " .. tostring(text))
    pcall(function()
        StarterGui:SetCore("SendNotification", { Title = "Nullscape GUI", Text = tostring(text), Duration = 3 })
    end)
end

------------------------------------------------------------------ game objects
notify("Nullscape GUI: loading...")

-- Everything is resolved lazily: the GUI opens even if some folders do not exist yet
-- (the game may create them only when a round starts). A missing folder is replaced
-- by an empty placeholder and picked up automatically as soon as it appears.
local EMPTY = Instance.new("Folder")
EMPTY.Name = "NullscapeEmpty"
local FALLBACK_ROUND = Instance.new("BoolValue")

local items, gifts, goldengifts, tripmines, goldtrip, bullets = EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY
local enemies, skinwalkers, currentRooms, pads, destroyFolder = EMPTY, EMPTY, EMPTY, EMPTY, EMPTY
local spawnPart = nil
local inRound = FALLBACK_ROUND
local counters = EMPTY
local missing = {}

local function refreshObjects()
    local m = {}
    local function get(parent, name, label)
        local o = nil
        if parent ~= EMPTY then o = parent:FindFirstChild(name) end
        if not o then m[#m + 1] = label end
        return o
    end
    local function opt(parent, name)
        if parent == EMPTY then return EMPTY end
        return parent:FindFirstChild(name) or EMPTY
    end
    items = get(workspace, "Item_Pools", "Item_Pools") or EMPTY
    gifts = get(items, "Gift", "Item_Pools.Gift") or EMPTY
    goldengifts = get(items, "GoldenGift", "Item_Pools.GoldenGift") or EMPTY
    tripmines = get(items, "Tripmine", "Item_Pools.Tripmine") or EMPTY
    goldtrip = opt(items, "GoldTripmines")
    bullets = opt(items, "Bullet")
    enemies = get(workspace, "Enemies", "Enemies") or EMPTY
    skinwalkers = opt(workspace, "Skinwalkers")
    currentRooms = get(workspace, "CurrentRooms", "CurrentRooms") or EMPTY
    pads = get(workspace, "JumpPads", "JumpPads") or EMPTY
    destroyFolder = opt(workspace, "DestroyFolder")
    spawnPart = workspace:FindFirstChild("Spawn")
    inRound = get(ReplicatedStorage, "InRound", "InRound") or FALLBACK_ROUND
    counters = get(ReplicatedStorage, "GiftCounters", "GiftCounters") or EMPTY
    missing = m
end
refreshObjects()
if #missing > 0 then
    notify("Not found yet: " .. table.concat(missing, ", ") .. " (the GUI works anyway and picks them up when they appear)")
end

local exiting = false
local roundStart = inRound.Value and (tick() - 100) or 0
local sawNeed = false
local lastExit = 0

------------------------------------------------------------------ helpers
local function charParts()
    local char = plr.Character
    if not char then return end
    local hum = char:FindFirstChildOfClass("Humanoid")
    if not hum or hum.Health <= 0 then return end
    local root = char:FindFirstChild("HumanoidRootPart") or hum.RootPart
    if not root then return end
    return char, root, char:FindFirstChild("Hitbox")
end

local function snap(root, hitbox, pos)
    root.AssemblyLinearVelocity = Vector3.zero
    root.Position = pos
    if hitbox then hitbox.Position = pos end
end

local function need(name)
    local c = counters:FindFirstChild(name)
    return (c and tonumber(c.Value)) or 0
end

-- gift collection range (same BindableEvent the old GUI used)
local magnetApplied = false
local function getMagnet()
    local ev = ReplicatedStorage:FindFirstChild("Events")
    local m = ev and ev:FindFirstChild("MovementGiftMagnet")
    if m and m:IsA("BindableEvent") then return m end
    return nil
end

local function applyMagnet()
    if CFG.magnet <= 0 then return end
    pcall(function()
        local m = getMagnet()
        if m then
            m:Fire({ Add = CFG.magnet })
            magnetApplied = true
            logEvent("gift range +" .. CFG.magnet .. " applied")
        else
            logEvent("MovementGiftMagnet event not found")
        end
    end)
end

local function resetMagnet(full)
    pcall(function()
        local m = getMagnet()
        if m then
            m:Fire({ Add = 1 })
            m:Fire({ Reset = full and math.huge or 1 })
            magnetApplied = false
        end
    end)
end

------------------------------------------------------------------ obstacles (mines) tracking
local obstacles = {}
local obsState = setmetatable({}, { __mode = "k" })
local obsAt = 0
local pRad = 3
local movingCount = 0
local routeBudget = 0

local function trackPart(part, dt, origin, list)
    local pos = part.Position
    if origin and (pos - origin).Magnitude > 700 then return end
    local st = obsState[part]
    if not st then
        st = { part = part, pos = pos, vel = Vector3.zero }
        obsState[part] = st
    else
        if dt > 0 and dt < 0.5 then
            local v = (pos - st.pos) / dt
            v = st.vel * 0.5 + v * 0.5
            if v.Magnitude < 0.6 or v.Magnitude > 80 then v = Vector3.zero end
            st.vel = v
        else
            st.vel = Vector3.zero
        end
        st.pos = pos
    end
    local speed = st.vel.Magnitude
    local grow = 0
    if CFG.predict then grow = math.min(speed * CFG.lookahead, 12) end
    st.reff = math.min(part.Size.Magnitude / 2, 30) + pRad + CFG.mineMargin + grow
    if speed > 0 then movingCount += 1 end
    list[#list + 1] = st
end

local function updateObstacles(force)
    local now = tick()
    local dt = now - obsAt
    if dt < (force and 0.03 or 0.05) then return end
    obsAt = now
    local _, root, hb = charParts()
    pRad = hb and math.clamp(hb.Size.Magnitude / 2, 2, 6) or 3
    local origin = root and root.Position
    local list = {}
    movingCount = 0

    local function addFolder(folder, needVisible)
        if not folder then return end
        for _, m in ipairs(folder:GetChildren()) do
            if m:IsA("BasePart") then
                if not needVisible or m.Transparency ~= 1 then trackPart(m, dt, origin, list) end
            elseif m:IsA("Model") and m.PrimaryPart then
                if not needVisible or m.PrimaryPart.Transparency ~= 1 then trackPart(m.PrimaryPart, dt, origin, list) end
            end
        end
    end

    addFolder(tripmines, true)
    addFolder(goldtrip, true)
    if CFG.avoidEnemies and not CFG.god then
        addFolder(enemies, false)
        addFolder(skinwalkers, false)
    end
    obstacles = list
end

local function segParam(p, a, b)
    local ab = b - a
    local l2 = ab:Dot(ab)
    local t = 0
    if l2 > 0 then t = math.clamp((p - a):Dot(ab) / l2, 0, 1) end
    return t, (p - (a + ab * t)).Magnitude
end

local function relevant(a, b, obs)
    local out = {}
    for _, o in ipairs(obs) do
        local _, d = segParam(o.pos, a, b)
        if d < o.reff + 40 then out[#out + 1] = o end
    end
    return out
end

local function pointSafe(p, obs)
    for _, o in ipairs(obs) do
        if (o.pos - p).Magnitude < o.reff then return false end
    end
    return true
end

-- first obstacle (along a->b) whose zone the segment enters
local function firstBlocker(a, b, obs)
    local bestT, bestO = math.huge, nil
    for _, o in ipairs(obs) do
        local t, d = segParam(o.pos, a, b)
        if d < o.reff then
            local blocked = true
            local startD = (o.pos - a).Magnitude
            if startD < o.reff then
                -- we already stand inside the zone: only block if we move deeper
                blocked = d < startD - 0.5
            end
            if blocked and t < bestT then bestT, bestO = t, o end
        end
    end
    return bestO
end

-- builds a list of waypoints from a to b that stays outside all zones, or nil
local function findRoute(a, b, obs, depth)
    routeBudget -= 1
    if routeBudget < 0 then return nil end
    local o = firstBlocker(a, b, obs)
    if not o then return { b }, (b - a).Magnitude end
    if depth <= 0 then return nil end

    local dir = b - a
    local dirU = dir.Magnitude > 0.01 and dir.Unit or Vector3.new(0, 0, 1)
    local side = dirU:Cross(Vector3.yAxis)
    side = side.Magnitude > 0.1 and side.Unit or Vector3.xAxis
    local off = o.reff + 2
    local cands = {
        o.pos + side * off,
        o.pos - side * off,
        o.pos + Vector3.yAxis * off,
        o.pos - Vector3.yAxis * off,
    }

    local best, bestLen
    for _, w in ipairs(cands) do
        if pointSafe(w, obs) then
            local r1, l1 = findRoute(a, w, obs, depth - 1)
            if r1 then
                local r2, l2 = findRoute(w, b, obs, depth - 1)
                if r2 then
                    local len = l1 + l2
                    if not bestLen or len < bestLen then
                        local route = {}
                        for _, p in ipairs(r1) do route[#route + 1] = p end
                        for _, p in ipairs(r2) do route[#route + 1] = p end
                        best, bestLen = route, len
                    end
                end
            end
        end
    end
    return best, bestLen
end

-- nearest position to `target` that is outside every mine zone (used for instant teleports)
local function safeNear(target)
    updateObstacles(true)
    if pointSafe(target, obstacles) then return target end
    for _, rad in ipairs({ 4, 8, 12, 18, 26 }) do
        for k = 0, 7 do
            local ang = k * math.pi / 4
            local cand = target + Vector3.new(math.cos(ang) * rad, 0, math.sin(ang) * rad)
            if pointSafe(cand, obstacles) then return cand end
        end
    end
    return target
end

------------------------------------------------------------------ gifts
local blacklist = setmetatable({}, { __mode = "k" })

local function pickCandidates(root, useNormal, useGolden, limit)
    local rp = root.Position
    local best = {}
    local function consider(g, d)
        local n = #best
        if n >= limit and d >= best[n].d then return end
        local pos = n + 1
        for i = 1, n do
            if d < best[i].d then pos = i break end
        end
        table.insert(best, pos, { g = g, d = d })
        if #best > limit then table.remove(best) end
    end
    local function scan(folder)
        for _, g in ipairs(folder:GetChildren()) do
            if g:IsA("BasePart") and g.Transparency ~= 1 and not (blacklist[g] and blacklist[g] > tick()) then
                local d = (g.Position - rp).Magnitude
                if (#best < limit or d < best[#best].d) and g:FindFirstChild("Collect", true) then
                    consider(g, d)
                end
            end
        end
    end
    if useNormal then scan(gifts) end
    if useGolden then scan(goldengifts) end
    return best
end

local function cancelTweens(t1, t2)
    t1:Cancel()
    if t2 then t2:Cancel() end
end

-- walks the route; returns "done" | "replan" | "abort"
local function followRoute(route, g)
    for _, wp in ipairs(route) do
        local _, root, hb = charParts()
        if not root then return "abort" end
        local dist = (wp - root.Position).Magnitude
        if dist > 0.5 then
            local info = TweenInfo.new(dist / CFG.speed, Enum.EasingStyle.Linear)
            local t1 = TweenService:Create(root, info, { Position = wp })
            local t2 = hb and TweenService:Create(hb, info, { Position = wp }) or nil
            local done = false
            local c = t1.Completed:Connect(function() done = true end)
            t1:Play()
            if t2 then t2:Play() end

            local lastNear, near = 0, {}
            while not done do
                RS.Heartbeat:Wait()
                local _, r = charParts()
                if not r or not running or not CFG.collect or exiting or not inRound.Value then
                    cancelTweens(t1, t2)
                    c:Disconnect()
                    return "abort"
                end
                if not g.Parent or g.Transparency == 1 then
                    cancelTweens(t1, t2)
                    c:Disconnect()
                    return "done"
                end
                updateObstacles()
                if tick() - lastNear > 0.2 then
                    lastNear = tick()
                    near = relevant(r.Position, wp, obstacles)
                end
                if firstBlocker(r.Position, wp, near) then
                    cancelTweens(t1, t2)
                    c:Disconnect()
                    return "replan"
                end
            end
            c:Disconnect()
            local _, r2, h2 = charParts()
            if r2 and h2 then h2.Position = r2.Position end
        end
    end
    return "done"
end

-- returns true if it did something (so the caller moves on), false if the gift was rejected
local function stillThere(g)
    return g.Parent ~= nil and g.Transparency ~= 1 and g:FindFirstChild("Collect", true) ~= nil
end

local function visit(g)
    diag.visits += 1
    for _ = 1, 4 do
        local _, root = charParts()
        if not root then return false end
        updateObstacles(true)
        local target = g.Position
        local obs = relevant(root.Position, target, obstacles)

        if not pointSafe(target, obs) then
            blacklist[g] = tick() + 3
            diag.unsafe += 1
            logEvent("skipped gift: inside a mine zone")
            return false
        end

        routeBudget = 4000
        local route = findRoute(root.Position, target, obs, 4)
        if not route then
            blacklist[g] = tick() + 4
            state.action = "no safe route"
            diag.noRoute += 1
            logEvent("skipped gift: no safe route around mines")
            return false
        end

        state.action = "collecting"
        local res = followRoute(route, g)
        if res == "abort" then return true end
        if res == "done" then
            local t0 = tick()
            while stillThere(g) and tick() - t0 < 0.6 do task.wait(0.03) end
            if stillThere(g) then
                -- touch did not register: put root + hitbox exactly on the gift once more
                local _, r2, h2 = charParts()
                if r2 then snap(r2, h2, g.Position) end
                t0 = tick()
                while stillThere(g) and tick() - t0 < 0.5 do task.wait(0.03) end
            end
            if stillThere(g) then
                blacklist[g] = tick() + 8
                diag.failed += 1
                logEvent("reached gift but it was NOT collected")
            else
                diag.collected += 1
            end
            return true
        end
        -- "replan": loop again from the current position with fresh mine data
    end
    blacklist[g] = tick() + 6
    return true
end

------------------------------------------------------------------ diagnostics
local function countGifts()
    local total, withC = 0, 0
    for _, f in ipairs({ gifts, goldengifts }) do
        for _, g in ipairs(f:GetChildren()) do
            total += 1
            if g:IsA("BasePart") and g.Transparency ~= 1 and g:FindFirstChild("Collect", true) then withC += 1 end
        end
    end
    diag.total, diag.withCollect = total, withC
end

local function diagGifts()
    updateObstacles(true)
    local out = {}
    local _, root, hb = charParts()
    out[#out + 1] = string.format("toggles: collect=%s god=%s choose=%s beacon=%s | exiting=%s | magnet=%s | avoidEnemies=%s",
        tostring(CFG.collect), tostring(CFG.god), tostring(CFG.choose), tostring(CFG.beacon),
        tostring(exiting), tostring(CFG.magnet), tostring(CFG.avoidEnemies))
    if root then
        out[#out + 1] = string.format("root=(%.0f,%.0f,%.0f) hitbox-offset=%.2f",
            root.Position.X, root.Position.Y, root.Position.Z, hb and (hb.Position - root.Position).Magnitude or -1)
    else
        out[#out + 1] = "no character root"
    end
    countGifts()
    out[#out + 1] = string.format("gifts in folder=%d collectable=%d | visits=%d collected=%d failed=%d unsafe=%d noRoute=%d",
        diag.total, diag.withCollect, diag.visits, diag.collected, diag.failed, diag.unsafe, diag.noRoute)
    for i, o in ipairs(obstacles) do
        if i > 12 then break end
        local part = o.part
        local d = root and (o.pos - root.Position).Magnitude or -1
        out[#out + 1] = string.format("obstacle %d: %s (%s) in %s size=%.1f dist=%.0f speed=%.1f zone=%.1f",
            i, part.Name, part.ClassName, part.Parent and part.Parent.Name or "?", part.Size.Magnitude, d, o.vel.Magnitude, o.reff or 0)
    end
    if root then
        local cands = pickCandidates(root, true, true, 6)
        for i, c in ipairs(cands) do
            local g = c.g
            local obs = relevant(root.Position, g.Position, obstacles)
            local safe = pointSafe(g.Position, obs)
            local route = nil
            if safe then
                routeBudget = 4000
                route = findRoute(root.Position, g.Position, obs, 4)
            end
            out[#out + 1] = string.format("gift %d: %s dist=%.0f safe=%s route=%s",
                i, g.Name, c.d, tostring(safe), route and (#route .. " pts") or "none")
        end
        if #cands == 0 then out[#out + 1] = "no candidate gifts (filtered, blacklisted or folder empty)" end
    end
    for _, l in ipairs(diag.log) do out[#out + 1] = "log: " .. l end
    return table.concat(out, "\n")
end

------------------------------------------------------------------ god mode
local function killEnemy(e)
    if not e or not e.Parent then return end
    pcall(function()
        for _, d in ipairs(e:GetDescendants()) do
            if d.Name == "TouchInterest" then
                d:Destroy()
            elseif (d:IsA("LocalScript") or d:IsA("Script")) and d.Name:find("_ClientAI", 1, true) then
                d.Enabled = false
            end
        end
        e:Destroy()
    end)
end

local function sweepFolder(folder)
    for _, e in ipairs(folder:GetChildren()) do killEnemy(e) end
end

local function sweepSeamines()
    for _, sm in ipairs(pads:GetChildren()) do
        if sm.Name == "Seamine" then
            local ti = sm:FindFirstChild("TouchInterest")
            if ti then ti:Destroy() end
            local ls = sm:FindFirstChild("ClientMine")
            if ls then pcall(function() ls.Enabled = false end) end
        end
    end
end

------------------------------------------------------------------ altars / picking
local IMAGES = {
    ["90968042204988"] = "ENEMIES",
    ["71252790926685"] = "CURSES",
    ["109624131383272"] = "UPGRADES",
}

local function signImage()
    local sel = workspace:FindFirstChild("Select")
    local sign = sel and sel:FindFirstChild("Sign")
    local bb = sign and sign:FindFirstChild("Billboard")
    local img = bb and bb:FindFirstChild("ImageLabel")
    return sel, img and tostring(img.Image) or nil
end

-- ENEMIES / CURSES / UPGRADES, "UNKNOWN" if the sign image is not recognised, nil if there is no Select model
local function intermissionType()
    local sel, image = signImage()
    if not sel then return nil end
    local id = image and image:match("%d+")
    return (id and IMAGES[id]) or "UNKNOWN"
end

local function stripTags(str)
    return (tostring(str or ""):gsub("<[^>]->", ""))
end

local function promptText(p)
    return stripTags((p.ObjectText or "") .. " " .. (p.ActionText or "")):lower()
end

-- the altar name: ActionText for break altars ("shotgun"), cleaned of rich text
local function altarName(p)
    local n = stripTags(p.ActionText):lower():match("^%s*(.-)%s*$")
    if n == "" then n = stripTags(p.ObjectText):lower():match("^%s*(.-)%s*$") end
    return n
end

local function collectPrompts()
    local list = {}
    for _, d in ipairs(currentRooms:GetDescendants()) do
        if d:IsA("ProximityPrompt") and d.Name == "Prompt" and d.Enabled then list[#list + 1] = d end
    end
    local sel = workspace:FindFirstChild("Select")
    if sel then
        for _, d in ipairs(sel:GetDescendants()) do
            if d:IsA("ProximityPrompt") and d.Enabled then list[#list + 1] = d end
        end
    end
    return list
end

local used = setmetatable({}, { __mode = "k" })

local function matchesAny(text, csv)
    for kw in string.gmatch(csv or "", "[^,]+") do
        kw = kw:lower():match("^%s*(.-)%s*$")
        if kw ~= "" and text:find(kw, 1, true) then return true end
    end
    return false
end

-- returns prompt, entry (nil when picked via "pick any"), category
local function chooseIn(prompts, cat, allowAny)
    local cfg = PICKS[cat]
    if not cfg or cfg.perBreak <= 0 or breakPicks[cat] >= cfg.perBreak then return nil end
    local free = {}
    for _, p in ipairs(prompts) do
        if not (used[p] and tick() - used[p] < 20) then free[#free + 1] = p end
    end
    for _, e in ipairs(cfg.entries) do
        if e.max == 0 or e.used < e.max then
            for _, p in ipairs(free) do
                if altarName(p):find(e.text, 1, true) then return p, e end
            end
            for _, p in ipairs(free) do
                if promptText(p):find(e.text, 1, true) then return p, e end
            end
        end
    end
    if allowAny and cfg.any then
        for _, p in ipairs(free) do
            if not matchesAny(promptText(p), cfg.avoid) then return p, nil end
        end
    end
    return nil
end

local function choose(prompts, typ)
    if typ == "UNKNOWN" then
        for _, cat in ipairs(TYPE_ORDER) do
            local p, e = chooseIn(prompts, cat, false)
            if p then return p, e, cat end
        end
        return nil
    end
    local p, e = chooseIn(prompts, typ, true)
    if p then return p, e, typ end
    return nil
end

local function promptPos(p)
    local par = p.Parent
    if not par then return nil end
    if par:IsA("Attachment") then return par.WorldPosition, nil end
    if par:IsA("BasePart") then return par.Position, par end
    if par:IsA("Model") then return par:GetPivot().Position, nil end
    return nil
end

local function activate(p)
    if not fireproximityprompt then
        notify("Your executor has no fireproximityprompt")
        return false
    end
    used[p] = tick()
    local _, root, hitbox = charParts()
    if not root then return false end
    local pos, part = promptPos(p)
    if not pos then return false end

    local prev = root.Position
    local target = part and (part.Position + part.CFrame.LookVector * -3) or (pos + Vector3.new(0, 3, 0))
    target = safeNear(target)

    local t0 = tick()
    repeat
        snap(root, hitbox, target)
        local cam = workspace.CurrentCamera
        if cam then cam.CFrame = CFrame.lookAt(target + Vector3.new(0, 1.5, 0), pos) end
        task.wait(0.05)
    until (root.Position - pos).Magnitude < 6 or tick() - t0 > 3

    fireproximityprompt(p)
    task.wait(math.max(p.HoldDuration, 0.1) + 0.1)
    snap(root, hitbox, safeNear(prev))
    return true
end

------------------------------------------------------------------ beacon / debug
local function goBeacon()
    local b = workspace:FindFirstChild("Beacon")
    local _, root, hitbox = charParts()
    if not b then
        logEvent("Beacon object not found in Workspace")
        notify("Beacon not found in Workspace")
        return
    end
    if not root then return end
    local pos = b:IsA("Model") and b:GetPivot().Position or b.Position
    snap(root, hitbox, safeNear(pos + Vector3.new(0, 4, 0)))
end

local function names(folder)
    local t = {}
    if folder then
        for _, c in ipairs(folder:GetChildren()) do t[#t + 1] = c.Name end
    end
    return table.concat(t, ", ")
end

local function dumpInfo()
    updateObstacles(true)
    local lines = {}
    local _, rawImg = signImage()
    lines[#lines + 1] = "InRound: " .. tostring(inRound.Value) .. " | type: " .. tostring(intermissionType()) .. " | sign image: " .. tostring(rawImg)
    lines[#lines + 1] = string.format("Needed: Gift=%s Golden=%s Passage=%s Tripmine=%s",
        need("Gift"), need("GoldenGift"), need("PassageGift"), need("Tripmine"))
    lines[#lines + 1] = string.format("Obstacles tracked: %d (moving: %d), player radius: %.1f",
        #obstacles, movingCount, pRad)
    for i, p in ipairs(collectPrompts()) do
        lines[#lines + 1] = "Altar " .. i .. ": " .. promptText(p) .. " | parent: " .. p:GetFullName()
    end
    local function f(a, b)
        local x = ReplicatedStorage:FindFirstChild(a)
        return x and x:FindFirstChild(b) or nil
    end
    lines[#lines + 1] = "Active curses: " .. names(f("CurseFolder", "Curses"))
    lines[#lines + 1] = "Active greater curses: " .. names(f("GreaterCurseFolder", "Curses"))
    lines[#lines + 1] = "Active upgrades: " .. names(f("UpgradeFolder", "Upgrades"))
    lines[#lines + 1] = "Enemies now: " .. names(enemies)
    lines[#lines + 1] = "---- gift diagnostics ----"
    local okD, dtext = pcall(diagGifts)
    lines[#lines + 1] = okD and dtext or ("diagnostics error: " .. tostring(dtext))
    local text = table.concat(lines, "\n")
    print("[NullscapeGUI] ---- dump ----\n" .. text)
    local clip = setclipboard or toclipboard or set_clipboard
    if clip then
        clip(text)
        notify("Debug info copied to clipboard (also in console F9)")
    else
        notify("Debug info printed to console (F9)")
    end
end

------------------------------------------------------------------ GUI
local THEME = {
    bg = Color3.fromRGB(16, 16, 22),
    panel = Color3.fromRGB(22, 22, 31),
    item = Color3.fromRGB(32, 32, 45),
    item2 = Color3.fromRGB(40, 40, 56),
    accent = Color3.fromRGB(124, 92, 255),
    off = Color3.fromRGB(70, 70, 90),
    text = Color3.fromRGB(235, 235, 245),
    sub = Color3.fromRGB(150, 150, 172),
    bad = Color3.fromRGB(220, 80, 90),
}

local function new(class, props, parent)
    local o = Instance.new(class)
    for k, v in pairs(props) do o[k] = v end
    if parent then o.Parent = parent end
    return o
end

local function corner(o, r)
    new("UICorner", { CornerRadius = UDim.new(0, r or 6) }, o)
end

local function randName()
    local t = {}
    for i = 1, 12 do t[i] = string.char(math.random(97, 122)) end
    return table.concat(t)
end

local sg = new("ScreenGui", {
    Name = randName(), ResetOnSpawn = false, IgnoreGuiInset = true,
    ZIndexBehavior = Enum.ZIndexBehavior.Sibling, DisplayOrder = 999,
})
do
    local ok = pcall(function()
        if gethui then sg.Parent = gethui() else sg.Parent = game:GetService("CoreGui") end
    end)
    if not ok or not sg.Parent then sg.Parent = plr:WaitForChild("PlayerGui") end
end

local zoneFolder = Instance.new("Folder")
zoneFolder.Name = randName()
zoneFolder.Parent = workspace

local function playSplash()
    local frame = new("Frame", {
        Size = UDim2.fromScale(1, 1), BackgroundColor3 = Color3.fromRGB(8, 8, 12),
        BorderSizePixel = 0, ZIndex = 100,
    }, sg)
    local title = new("TextLabel", {
        AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.44),
        Size = UDim2.fromOffset(700, 80), BackgroundTransparency = 1, Text = "Rip_Moriarty",
        Font = Enum.Font.GothamBlack, TextSize = 60, TextColor3 = THEME.accent,
        TextTransparency = 1, ZIndex = 101,
    }, frame)
    local sub = new("TextLabel", {
        AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.52),
        Size = UDim2.fromOffset(700, 30), BackgroundTransparency = 1, Text = "N U L L S C A P E   G U I",
        Font = Enum.Font.GothamBold, TextSize = 18, TextColor3 = THEME.sub,
        TextTransparency = 1, ZIndex = 101,
    }, frame)
    local barBg = new("Frame", {
        AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.6),
        Size = UDim2.fromOffset(280, 4), BackgroundColor3 = Color3.fromRGB(36, 36, 50),
        BorderSizePixel = 0, ZIndex = 101, BackgroundTransparency = 1,
    }, frame)
    corner(barBg, 2)
    local bar = new("Frame", {
        Size = UDim2.fromScale(0, 1), BackgroundColor3 = THEME.accent, BorderSizePixel = 0,
        ZIndex = 102, BackgroundTransparency = 1,
    }, barBg)
    corner(bar, 2)

    local fadeIn = TweenInfo.new(0.6, Enum.EasingStyle.Quad)
    TweenService:Create(title, fadeIn, { TextTransparency = 0 }):Play()
    TweenService:Create(sub, fadeIn, { TextTransparency = 0 }):Play()
    TweenService:Create(barBg, fadeIn, { BackgroundTransparency = 0 }):Play()
    TweenService:Create(bar, fadeIn, { BackgroundTransparency = 0 }):Play()
    task.wait(0.4)
    TweenService:Create(bar, TweenInfo.new(1.8, Enum.EasingStyle.Quad), { Size = UDim2.fromScale(1, 1) }):Play()
    task.wait(2.2)

    local fadeOut = TweenInfo.new(0.5, Enum.EasingStyle.Quad)
    TweenService:Create(title, fadeOut, { TextTransparency = 1 }):Play()
    TweenService:Create(sub, fadeOut, { TextTransparency = 1 }):Play()
    TweenService:Create(barBg, fadeOut, { BackgroundTransparency = 1 }):Play()
    TweenService:Create(bar, fadeOut, { BackgroundTransparency = 1 }):Play()
    TweenService:Create(frame, fadeOut, { BackgroundTransparency = 1 }):Play()
    task.wait(0.55)
    frame:Destroy()
end

playSplash()

-- window
local win = new("Frame", {
    Name = "Window", AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5),
    Size = UDim2.fromOffset(620, 420), BackgroundColor3 = THEME.bg, BorderSizePixel = 0, ClipsDescendants = true,
}, sg)
corner(win, 10)
new("UIStroke", { Color = THEME.accent, Thickness = 1, Transparency = 0.5 }, win)

local titleBar = new("Frame", { Size = UDim2.new(1, 0, 0, 38), BackgroundColor3 = THEME.panel, BorderSizePixel = 0 }, win)
new("TextLabel", {
    BackgroundTransparency = 1, Position = UDim2.fromOffset(14, 0), Size = UDim2.new(0.6, 0, 1, 0),
    Text = "Nullscape GUI", Font = Enum.Font.GothamBold, TextSize = 16, TextColor3 = THEME.text,
    TextXAlignment = Enum.TextXAlignment.Left,
}, titleBar)
new("TextLabel", {
    BackgroundTransparency = 1, AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -80, 0, 0),
    Size = UDim2.fromOffset(200, 38), Text = "by Rip_Moriarty", Font = Enum.Font.Gotham, TextSize = 12,
    TextColor3 = THEME.sub, TextXAlignment = Enum.TextXAlignment.Right,
}, titleBar)

local function titleButton(text, offset, cb)
    local b = new("TextButton", {
        AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -offset, 0.5, 0), Size = UDim2.fromOffset(26, 24),
        BackgroundColor3 = THEME.item, Text = text, Font = Enum.Font.GothamBold, TextSize = 14,
        TextColor3 = THEME.text, AutoButtonColor = true, BorderSizePixel = 0,
    }, titleBar)
    corner(b, 6)
    b.MouseButton1Click:Connect(cb)
    return b
end

local stop -- forward declaration
titleButton("X", 8, function() stop() end)
titleButton("-", 40, function() win.Visible = false end)

-- dragging
do
    local dragging, dragStart, startPos = false, nil, nil
    titleBar.InputBegan:Connect(function(i)
        if i.UserInputType == Enum.UserInputType.MouseButton1 or i.UserInputType == Enum.UserInputType.Touch then
            dragging, dragStart, startPos = true, i.Position, win.Position
        end
    end)
    conns[#conns + 1] = UIS.InputChanged:Connect(function(i)
        if dragging and (i.UserInputType == Enum.UserInputType.MouseMovement or i.UserInputType == Enum.UserInputType.Touch) then
            local d = i.Position - dragStart
            win.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + d.X, startPos.Y.Scale, startPos.Y.Offset + d.Y)
        end
    end)
    conns[#conns + 1] = UIS.InputEnded:Connect(function(i)
        if i.UserInputType == Enum.UserInputType.MouseButton1 or i.UserInputType == Enum.UserInputType.Touch then
            dragging = false
        end
    end)
end

local tabBar = new("Frame", {
    Position = UDim2.fromOffset(0, 38), Size = UDim2.new(0, 130, 1, -38), BackgroundColor3 = THEME.panel, BorderSizePixel = 0,
}, win)
new("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }, tabBar)
new("UIPadding", { PaddingTop = UDim.new(0, 8), PaddingLeft = UDim.new(0, 8), PaddingRight = UDim.new(0, 8) }, tabBar)

local content = new("Frame", {
    Position = UDim2.fromOffset(130, 38), Size = UDim2.new(1, -130, 1, -38), BackgroundTransparency = 1,
}, win)

local pages, tabButtons = {}, {}
local tabCount = 0

local function selectTab(name)
    for n, p in pairs(pages) do p.frame.Visible = (n == name) end
    for n, b in pairs(tabButtons) do
        b.BackgroundColor3 = (n == name) and THEME.accent or THEME.item
    end
end

local function makePage(name)
    tabCount += 1
    local P = { n = 0 }
    function P:order()
        self.n += 1
        return self.n
    end
    P.frame = new("ScrollingFrame", {
        BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), CanvasSize = UDim2.new(),
        AutomaticCanvasSize = Enum.AutomaticSize.Y, ScrollBarThickness = 3, BorderSizePixel = 0, Visible = false,
    }, content)
    new("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }, P.frame)
    new("UIPadding", {
        PaddingTop = UDim.new(0, 8), PaddingLeft = UDim.new(0, 8), PaddingRight = UDim.new(0, 8), PaddingBottom = UDim.new(0, 8),
    }, P.frame)
    pages[name] = P

    local b = new("TextButton", {
        Size = UDim2.new(1, 0, 0, 32), BackgroundColor3 = THEME.item, Text = name, Font = Enum.Font.GothamBold,
        TextSize = 13, TextColor3 = THEME.text, AutoButtonColor = false, BorderSizePixel = 0, LayoutOrder = tabCount,
    }, tabBar)
    corner(b, 6)
    b.MouseButton1Click:Connect(function() selectTab(name) end)
    tabButtons[name] = b
    return P
end

local function addRow(P, h)
    local f = new("Frame", { Size = UDim2.new(1, -4, 0, h), BackgroundColor3 = THEME.item, BorderSizePixel = 0, LayoutOrder = P:order() }, P.frame)
    corner(f)
    return f
end

local function section(P, text)
    new("TextLabel", {
        Size = UDim2.new(1, -4, 0, 22), BackgroundTransparency = 1, Text = string.upper(text), Font = Enum.Font.GothamBold,
        TextSize = 12, TextColor3 = THEME.accent, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = P:order(),
    }, P.frame)
end

local function addLabel(P, text, h)
    local row = addRow(P, h or 26)
    local l = new("TextLabel", {
        BackgroundTransparency = 1, Position = UDim2.fromOffset(10, 0), Size = UDim2.new(1, -20, 1, 0), Text = text,
        Font = Enum.Font.Gotham, TextSize = 13, TextColor3 = THEME.sub, TextXAlignment = Enum.TextXAlignment.Left,
        TextWrapped = true,
    }, row)
    return l
end

local refreshers = {}

local function addToggle(P, text, get, set, key)
    local row = addRow(P, 34)
    new("TextLabel", {
        BackgroundTransparency = 1, Position = UDim2.fromOffset(10, 0), Size = UDim2.new(1, -70, 1, 0), Text = text,
        Font = Enum.Font.Gotham, TextSize = 14, TextColor3 = THEME.text, TextXAlignment = Enum.TextXAlignment.Left,
    }, row)
    local sw = new("TextButton", {
        Text = "", AutoButtonColor = false, AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -10, 0.5, 0),
        Size = UDim2.fromOffset(40, 20), BackgroundColor3 = THEME.off, BorderSizePixel = 0,
    }, row)
    corner(sw, 10)
    local knob = new("Frame", {
        Size = UDim2.fromOffset(16, 16), Position = UDim2.fromOffset(2, 2), BackgroundColor3 = Color3.new(1, 1, 1), BorderSizePixel = 0,
    }, sw)
    corner(knob, 8)
    local function refresh()
        local on = get()
        TweenService:Create(sw, TweenInfo.new(0.12), { BackgroundColor3 = on and THEME.accent or THEME.off }):Play()
        TweenService:Create(knob, TweenInfo.new(0.12), { Position = on and UDim2.fromOffset(22, 2) or UDim2.fromOffset(2, 2) }):Play()
    end
    refresh()
    if key then refreshers[key] = refresh end
    sw.MouseButton1Click:Connect(function()
        set(not get())
        refresh()
        saveSoon()
    end)
    return refresh
end

local function cfgToggle(P, text, key, onChange)
    return addToggle(P, text, function() return CFG[key] end, function(v)
        CFG[key] = v
        if onChange then onChange(v) end
    end, key)
end

local function addSlider(P, text, key, min, max, step, fmt)
    local row = addRow(P, 50)
    local lbl = new("TextLabel", {
        BackgroundTransparency = 1, Position = UDim2.fromOffset(10, 4), Size = UDim2.new(1, -20, 0, 20), Text = "",
        Font = Enum.Font.Gotham, TextSize = 14, TextColor3 = THEME.text, TextXAlignment = Enum.TextXAlignment.Left,
    }, row)
    local bar = new("Frame", {
        Position = UDim2.new(0, 10, 0, 34), Size = UDim2.new(1, -20, 0, 6), BackgroundColor3 = THEME.off, BorderSizePixel = 0,
    }, row)
    corner(bar, 3)
    local fill = new("Frame", { Size = UDim2.fromScale(0, 1), BackgroundColor3 = THEME.accent, BorderSizePixel = 0 }, bar)
    corner(fill, 3)
    local hit = new("TextButton", {
        BackgroundTransparency = 1, Text = "", Position = UDim2.new(0, 10, 0, 26), Size = UDim2.new(1, -20, 0, 22),
    }, row)

    local function show()
        local v = CFG[key]
        lbl.Text = text .. ": " .. string.format(fmt or "%g", v)
        fill.Size = UDim2.fromScale(math.clamp((v - min) / (max - min), 0, 1), 1)
    end
    show()

    local dragging = false
    local function setFromX(x)
        local rel = math.clamp((x - bar.AbsolutePosition.X) / math.max(bar.AbsoluteSize.X, 1), 0, 1)
        local v = min + rel * (max - min)
        v = math.floor(v / step + 0.5) * step
        CFG[key] = math.clamp(v, min, max)
        show()
        saveSoon()
    end
    hit.InputBegan:Connect(function(i)
        if i.UserInputType == Enum.UserInputType.MouseButton1 or i.UserInputType == Enum.UserInputType.Touch then
            dragging = true
            setFromX(i.Position.X)
        end
    end)
    conns[#conns + 1] = UIS.InputChanged:Connect(function(i)
        if dragging and (i.UserInputType == Enum.UserInputType.MouseMovement or i.UserInputType == Enum.UserInputType.Touch) then
            setFromX(i.Position.X)
        end
    end)
    conns[#conns + 1] = UIS.InputEnded:Connect(function(i)
        if i.UserInputType == Enum.UserInputType.MouseButton1 or i.UserInputType == Enum.UserInputType.Touch then
            dragging = false
        end
    end)
end

local function addButton(P, text, cb)
    local row = addRow(P, 34)
    local b = new("TextButton", {
        Size = UDim2.new(1, -16, 0, 26), Position = UDim2.fromOffset(8, 4), BackgroundColor3 = THEME.accent, Text = text,
        Font = Enum.Font.GothamBold, TextSize = 13, TextColor3 = Color3.new(1, 1, 1), AutoButtonColor = true, BorderSizePixel = 0,
    }, row)
    corner(b, 6)
    b.MouseButton1Click:Connect(cb)
    return b
end

local function smallButton(parent, text, offFromRight, w, cb, color)
    local b = new("TextButton", {
        AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -offFromRight, 0.5, 0), Size = UDim2.fromOffset(w, 22),
        BackgroundColor3 = color or THEME.off, Text = text, Font = Enum.Font.GothamBold, TextSize = 13,
        TextColor3 = Color3.new(1, 1, 1), AutoButtonColor = true, BorderSizePixel = 0,
    }, parent)
    corner(b, 5)
    b.MouseButton1Click:Connect(cb)
    return b
end

local function addStepper(P, text, get, set, min, max)
    local row = addRow(P, 34)
    new("TextLabel", {
        BackgroundTransparency = 1, Position = UDim2.fromOffset(10, 0), Size = UDim2.new(1, -140, 1, 0), Text = text,
        Font = Enum.Font.Gotham, TextSize = 14, TextColor3 = THEME.text, TextXAlignment = Enum.TextXAlignment.Left,
    }, row)
    local val = new("TextLabel", {
        AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -40, 0.5, 0), Size = UDim2.fromOffset(50, 22),
        BackgroundTransparency = 1, Text = "", Font = Enum.Font.GothamBold, TextSize = 14, TextColor3 = THEME.text,
    }, row)
    local function show() val.Text = tostring(get()) end
    show()
    smallButton(row, "-", 94, 26, function() set(math.max(min, get() - 1)) show() saveSoon() end)
    smallButton(row, "+", 8, 26, function() set(math.min(max, get() + 1)) show() saveSoon() end, THEME.accent)
    return show
end

local function addTextBoxRow(P, placeholder, btnText, onSubmit)
    local row = addRow(P, 34)
    local box = new("TextBox", {
        Position = UDim2.fromOffset(8, 4), Size = UDim2.new(1, -110, 0, 26), BackgroundColor3 = THEME.item2,
        Text = "", PlaceholderText = placeholder, PlaceholderColor3 = THEME.sub, TextColor3 = THEME.text,
        Font = Enum.Font.Gotham, TextSize = 13, ClearTextOnFocus = false, BorderSizePixel = 0,
        TextXAlignment = Enum.TextXAlignment.Left,
    }, row)
    corner(box, 6)
    new("UIPadding", { PaddingLeft = UDim.new(0, 8) }, box)
    smallButton(row, btnText, 8, 84, function() onSubmit(box.Text, box) end, THEME.accent)
    return box
end

------------------------------------------------------------------ pages
local pMain = makePage("Main")
local pPicks = makePage("Picks")
local pMines = makePage("Mines")
local pInfo = makePage("Info")

-- Main
section(pMain, "Features")
cfgToggle(pMain, "Auto collect gifts  [Z]", "collect")
cfgToggle(pMain, "God mode (destroy enemies)  [X]", "god")
cfgToggle(pMain, "Auto pick in intermission  [C]", "choose")
cfgToggle(pMain, "Auto go to beacon  [V]", "beacon")
cfgToggle(pMain, "Collect ALL gifts (not only needed)", "collectAll")
cfgToggle(pMain, "Wait for passage gifts before beacon", "beaconWaitPassage")
addSlider(pMain, "Move speed (studs/s)", "speed", 40, 200, 5, "%d")
addSlider(pMain, "Gift range at round start (0 = off)", "magnet", 0, 30, 1, "%d")
addButton(pMain, "Apply gift range now", function() applyMagnet() end)
addButton(pMain, "Reset gift range", function() resetMagnet(false) end)
section(pMain, "Status")
local stRound = addLabel(pMain, "Round: ...")
local stNeed = addLabel(pMain, "Needed: ...")
local stMines = addLabel(pMain, "Mines: ...")
local stAction = addLabel(pMain, "Action: ...")
local stObjects = addLabel(pMain, "Objects: ...")
local stGifts = addLabel(pMain, "Gifts: ...", 40)
local stLog = addLabel(pMain, "", 110)
stLog.TextYAlignment = Enum.TextYAlignment.Top
stLog.TextSize = 12
addButton(pMain, "Teleport to beacon now", function() pcall(goBeacon) end)
addButton(pMain, "Copy full diagnostics to clipboard", dumpInfo)

-- Mines
section(pMines, "Mine avoidance")
addLabel(pMines, "Every active mine gets a danger sphere (mine size + your hitbox + margin). The path is planned AROUND these spheres and re-checked every frame. The script never teleports you through or into a sphere; if no safe route exists the gift is skipped.", 84)
addSlider(pMines, "Safety margin (studs)", "mineMargin", 0, 12, 0.5, "%.1f")
cfgToggle(pMines, "Predict moving mines", "predict")
addSlider(pMines, "Prediction time (s)", "lookahead", 0, 4, 0.1, "%.1f")
cfgToggle(pMines, "Avoid enemies when god mode is off", "avoidEnemies")
cfgToggle(pMines, "Show danger zones", "showZones")

-- Info
section(pInfo, "Hotkeys")
addLabel(pInfo, "RightShift - show / hide GUI\nZ collect | X god | C auto pick | V beacon\nB copy debug info | P stop script", 62)
section(pInfo, "Tools")
addButton(pInfo, "Copy debug info (altars, counters, mines)", dumpInfo)
addButton(pInfo, "Reset 'used' counters in Picks", function()
    for _, p in pairs(PICKS) do
        for _, e in ipairs(p.entries) do e.used = 0 end
    end
    for k in pairs(breakPicks) do breakPicks[k] = 0 end
    for _, typ in ipairs(TYPE_ORDER) do if UI["render" .. typ] then UI["render" .. typ]() end end
    notify("Counters reset")
end)
addButton(pInfo, "Stop script and close GUI", function() stop() end)
section(pInfo, "About")
addLabel(pInfo, "Nullscape GUI by Rip_Moriarty. Settings are saved to NullscapeGUI.json (if your executor supports writefile).", 48)

-- Picks
addLabel(pPicks, "What the cheat takes at the altars during a break. Entries are tried top to bottom; 'x/y' = times taken / maximum (y = inf means unlimited). 'Picks per break' = how many altars of that type are taken in one break (0 = skip the type).", 98)

local function buildPicksSection(typ)
    local cfg = PICKS[typ]
    section(pPicks, TYPE_TITLES[typ])
    addStepper(pPicks, "Picks per break (0 = skip)", function() return cfg.perBreak end, function(v) cfg.perBreak = v end, 0, 10)

    local list = new("Frame", {
        BackgroundTransparency = 1, Size = UDim2.new(1, -4, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = pPicks:order(),
    }, pPicks.frame)
    new("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }, list)

    local function render()
        for _, c in ipairs(list:GetChildren()) do
            if c:IsA("Frame") then c:Destroy() end
        end
        if #cfg.entries == 0 then
            local r = new("Frame", { Size = UDim2.new(1, 0, 0, 26), BackgroundColor3 = THEME.item, BorderSizePixel = 0, LayoutOrder = 1 }, list)
            corner(r)
            new("TextLabel", {
                BackgroundTransparency = 1, Position = UDim2.fromOffset(10, 0), Size = UDim2.new(1, -20, 1, 0),
                Text = "(empty - nothing will be picked unless 'Pick any' is on)", Font = Enum.Font.Gotham, TextSize = 12,
                TextColor3 = THEME.sub, TextXAlignment = Enum.TextXAlignment.Left,
            }, r)
        end
        for i, e in ipairs(cfg.entries) do
            local row = new("Frame", { Size = UDim2.new(1, 0, 0, 30), BackgroundColor3 = THEME.item2, BorderSizePixel = 0, LayoutOrder = i }, list)
            corner(row)
            new("TextLabel", {
                BackgroundTransparency = 1, Position = UDim2.fromOffset(10, 0), Size = UDim2.new(1, -190, 1, 0),
                Text = i .. ". " .. e.text, Font = Enum.Font.Gotham, TextSize = 13, TextColor3 = THEME.text,
                TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd,
            }, row)
            smallButton(row, "x", 6, 24, function()
                table.remove(cfg.entries, i)
                render()
                saveSoon()
            end, THEME.bad)
            smallButton(row, "^", 34, 24, function()
                if i > 1 then
                    cfg.entries[i], cfg.entries[i - 1] = cfg.entries[i - 1], cfg.entries[i]
                    render()
                    saveSoon()
                end
            end)
            smallButton(row, "+", 62, 24, function()
                e.max = math.min(99, e.max + 1)
                render()
                saveSoon()
            end, THEME.accent)
            new("TextLabel", {
                AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -90, 0.5, 0), Size = UDim2.fromOffset(50, 22),
                BackgroundTransparency = 1, Text = e.used .. "/" .. (e.max == 0 and "inf" or tostring(e.max)),
                Font = Enum.Font.GothamBold, TextSize = 13, TextColor3 = THEME.text,
            }, row)
            smallButton(row, "-", 144, 24, function()
                e.max = math.max(0, e.max - 1)
                render()
                saveSoon()
            end)
        end
    end
    UI["render" .. typ] = render
    render()

    addTextBoxRow(pPicks, "altar text keyword (e.g. damage)", "Add", function(text, box)
        text = (text or ""):lower():match("^%s*(.-)%s*$")
        if text == "" then return end
        for _, e in ipairs(cfg.entries) do
            if e.text == text then return end
        end
        cfg.entries[#cfg.entries + 1] = { text = text, max = 1, used = 0 }
        box.Text = ""
        render()
        saveSoon()
    end)

    -- scan current altars and add with one click
    local results = new("Frame", {
        BackgroundTransparency = 1, Size = UDim2.new(1, -4, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 0,
    }, pPicks.frame)
    new("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }, results)

    addButton(pPicks, "Scan altars now (works during a break)", function()
        for _, c in ipairs(results:GetChildren()) do
            if c:IsA("GuiObject") then c:Destroy() end
        end
        local seen, n = {}, 0
        for _, p in ipairs(collectPrompts()) do
            local t = altarName(p)
            if t ~= "" and not seen[t] then
                seen[t] = true
                n += 1
                local b = new("TextButton", {
                    Size = UDim2.new(1, 0, 0, 26), BackgroundColor3 = THEME.item2, Text = "+ " .. t, Font = Enum.Font.Gotham,
                    TextSize = 13, TextColor3 = THEME.text, AutoButtonColor = true, BorderSizePixel = 0, LayoutOrder = n,
                }, results)
                corner(b, 5)
                b.MouseButton1Click:Connect(function()
                    for _, e in ipairs(cfg.entries) do
                        if e.text == t then return end
                    end
                    cfg.entries[#cfg.entries + 1] = { text = t, max = 1, used = 0 }
                    render()
                    saveSoon()
                end)
            end
        end
        if n == 0 then
            new("TextLabel", {
                Size = UDim2.new(1, 0, 0, 24), BackgroundTransparency = 1, Text = "No altars found right now (they exist during a break).",
                Font = Enum.Font.Gotham, TextSize = 12, TextColor3 = THEME.sub, TextXAlignment = Enum.TextXAlignment.Left,
                LayoutOrder = 1,
            }, results)
        end
    end)
    -- move the results frame right after the scan button
    results.LayoutOrder = pPicks:order()

    addToggle(pPicks, "Pick any altar if nothing matches", function() return cfg.any end, function(v) cfg.any = v end)
    local avoidRow = addTextBoxRow(pPicks, "avoid words, comma separated (used by 'pick any')", "Set", function(text)
        cfg.avoid = (text or ""):lower()
        saveSoon()
        notify(typ .. " avoid list saved")
    end)
    avoidRow.Text = cfg.avoid or ""
end

for _, typ in ipairs(TYPE_ORDER) do buildPicksSection(typ) end

selectTab("Main")

-- GUI show/hide + hotkeys
local function toggleKey(key, label)
    CFG[key] = not CFG[key]
    if refreshers[key] then refreshers[key]() end
    saveSoon()
    notify(label .. ": " .. (CFG[key] and "ON" or "OFF"))
end

conns[#conns + 1] = UIS.InputBegan:Connect(function(input, gp)
    if gp then return end
    local k = input.KeyCode
    if k == Enum.KeyCode.RightShift then win.Visible = not win.Visible
    elseif k == Enum.KeyCode.Z then toggleKey("collect", "Auto collect")
    elseif k == Enum.KeyCode.X then toggleKey("god", "God mode")
    elseif k == Enum.KeyCode.C then toggleKey("choose", "Auto pick")
    elseif k == Enum.KeyCode.V then toggleKey("beacon", "Auto beacon")
    elseif k == Enum.KeyCode.B then dumpInfo()
    elseif k == Enum.KeyCode.P then stop()
    end
end)

------------------------------------------------------------------ stop
stop = function()
    if not running then return end
    running = false
    if magnetApplied then resetMagnet(true) end
    for _, c in ipairs(conns) do pcall(function() c:Disconnect() end) end
    pcall(function() zoneFolder:Destroy() end)
    pcall(function() sg:Destroy() end)
    env.NullscapeGuiStop = nil
    print("[NullscapeGUI] stopped")
end
env.NullscapeGuiStop = stop

------------------------------------------------------------------ engine
-- status labels
task.spawn(function()
    while running do
        updateObstacles()
        local typ = intermissionType()
        stRound.Text = "Round: " .. (inRound.Value and "IN ROUND" or ("break (" .. tostring(typ) .. ")"))
        stNeed.Text = string.format("Needed - gifts: %d | golden: %d | passage: %d | tripmines: %d",
            need("Gift"), need("GoldenGift"), need("PassageGift"), need("Tripmine"))
        stMines.Text = string.format("Mines tracked: %d (moving: %d)", #obstacles, movingCount)
        stAction.Text = "Action: " .. state.action
        stObjects.Text = (#missing == 0) and "Objects: all found" or ("Not found yet: " .. table.concat(missing, ", "))
        if tick() - diag.countAt > 1 then
            diag.countAt = tick()
            pcall(countGifts)
        end
        stGifts.Text = string.format("Gifts in folder: %d (collectable %d) | collected: %d | failed: %d | skipped: mine zone %d, no route %d",
            diag.total, diag.withCollect, diag.collected, diag.failed, diag.unsafe, diag.noRoute)
        stLog.Text = table.concat(diag.log, "\n")
        task.wait(0.4)
    end
end)

-- danger zone visualizer
task.spawn(function()
    local adorns = {}
    while running do
        if CFG.showZones then
            local _, root = charParts()
            local origin = root and root.Position
            local alive = {}
            for _, st in ipairs(obstacles) do
                if st.part and st.part.Parent and (not origin or (st.pos - origin).Magnitude < 160) then
                    alive[st] = true
                    local a = adorns[st]
                    if not a then
                        a = Instance.new("SphereHandleAdornment")
                        a.Adornee = st.part
                        a.AlwaysOnTop = true
                        a.ZIndex = 0
                        a.Transparency = 0.8
                        a.Color3 = Color3.fromRGB(255, 60, 60)
                        a.Parent = zoneFolder
                        adorns[st] = a
                    end
                    a.Radius = st.reff or 5
                end
            end
            for st, a in pairs(adorns) do
                if not alive[st] then
                    a:Destroy()
                    adorns[st] = nil
                end
            end
        elseif next(adorns) then
            for st, a in pairs(adorns) do
                a:Destroy()
                adorns[st] = nil
            end
        end
        task.wait(0.15)
    end
end)

-- gift collecting
task.spawn(function()
    while running do
        task.wait(0.05)
        if not (CFG.collect and inRound.Value) or exiting then
            if state.action == "collecting" or state.action == "no gifts" then state.action = "idle" end
            continue
        end
        local _, root = charParts()
        if not root then continue end

        local grace = tick() - roundStart < 8
        local needNormal = need("Gift") > 0
        local needGolden = need("GoldenGift") > 0 or need("PassageGift") > 0
        local useNormal = needNormal or CFG.collectAll or grace
        local useGolden = needGolden or CFG.collectAll or grace

        if not (useNormal or useGolden) then
            state.action = "nothing needed"
            task.wait(0.4)
            continue
        end

        updateObstacles(true)
        local cands = pickCandidates(root, useNormal, useGolden, 8)
        local did = false
        for _, c in ipairs(cands) do
            local ok, res = pcall(visit, c.g)
            if not ok then
                if CFG.debug then warn("[NullscapeGUI] visit error: " .. tostring(res)) end
                logEvent("visit error: " .. tostring(res):sub(1, 70))
                blacklist[c.g] = tick() + 5
            elseif res then
                did = true
                break
            end
        end
        if not did then
            if #cands == 0 then
                state.action = "no gifts"
                logEvent("no candidate gifts (all skipped or none collectable)")
            end
            task.wait(0.3)
        end
    end
end)

-- god mode sweeps
task.spawn(function()
    while running do
        if CFG.god then
            pcall(function()
                sweepFolder(enemies)
                if skinwalkers then sweepFolder(skinwalkers) end
                sweepSeamines()
            end)
        end
        task.wait(0.25)
    end
end)

local conEnemies, conSkin, conDestroy, conRound
local lastEnemies, lastSkin, lastDestroy, lastRoundObj

local function rebind()
    if enemies ~= lastEnemies then
        lastEnemies = enemies
        if conEnemies then conEnemies:Disconnect() conEnemies = nil end
        if enemies ~= EMPTY then
            conEnemies = enemies.ChildAdded:Connect(function(e)
                if CFG.god then task.defer(killEnemy, e) end
            end)
            conns[#conns + 1] = conEnemies
        end
    end
    if skinwalkers ~= lastSkin then
        lastSkin = skinwalkers
        if conSkin then conSkin:Disconnect() conSkin = nil end
        if skinwalkers ~= EMPTY then
            conSkin = skinwalkers.ChildAdded:Connect(function(e)
                if CFG.god then task.defer(killEnemy, e) end
            end)
            conns[#conns + 1] = conSkin
        end
    end
    if destroyFolder ~= lastDestroy then
        lastDestroy = destroyFolder
        if conDestroy then conDestroy:Disconnect() conDestroy = nil end
        if destroyFolder ~= EMPTY then
            conDestroy = destroyFolder.ChildAdded:Connect(function(c)
                if CFG.god and c.Name == "VoidExplosion" then c:Destroy() end
            end)
            conns[#conns + 1] = conDestroy
        end
    end
    if inRound ~= lastRoundObj then
        lastRoundObj = inRound
        if conRound then conRound:Disconnect() conRound = nil end
        if inRound ~= FALLBACK_ROUND then
            if inRound.Value then
                roundStart = tick() - 100
                task.defer(applyMagnet)
            end
            conRound = inRound:GetPropertyChangedSignal("Value"):Connect(function()
                if inRound.Value then
                    roundStart = tick()
                    sawNeed = false
                    exiting = false
                    lastExit = 0
                    task.defer(applyMagnet)
                else
                    for k in pairs(breakPicks) do breakPicks[k] = 0 end
                end
            end)
            conns[#conns + 1] = conRound
        end
    end
end

pcall(rebind)
task.spawn(function()
    while running do
        task.wait(1)
        pcall(refreshObjects)
        pcall(rebind)
    end
end)

-- keep the hitbox glued to the root every frame (the old GUI did this too; the game reads the hitbox)
conns[#conns + 1] = RS.Heartbeat:Connect(function()
    if not running then return end
    local _, root, hb = charParts()
    if root and hb then hb.Position = root.Position end
end)

conns[#conns + 1] = RS.Heartbeat:Connect(function()
    if not running or not CFG.god then return end
    local char, root, hitbox = charParts()
    if not root then return end

    local rb = char:FindFirstChild("Razorbloom")
    if rb then rb:Destroy() end

    local kv = workspace:FindFirstChild("KillVoid")
    if kv and spawnPart and root.Position.Y <= kv.Position.Y + 75 then
        snap(root, hitbox, safeNear(spawnPart.Position + Vector3.new(0, 4, 0)))
        return
    end

    if bullets then
        local rp = root.Position
        for _, b in ipairs(bullets:GetChildren()) do
            if b:IsA("BasePart") and b.Transparency ~= 1 then
                local off = rp - b.Position
                if off.Magnitude < b.Size.X / 2 + 4 then
                    local dir = Vector3.new(off.X, 0, off.Z)
                    dir = dir.Magnitude > 0.1 and dir.Unit or Vector3.new(1, 0, 0)
                    local params = RaycastParams.new()
                    params.FilterType = Enum.RaycastFilterType.Exclude
                    params.FilterDescendantsInstances = { char }
                    local hit = workspace:Raycast(rp, dir * 6, params)
                    local np = (hit and hit.Instance.CanCollide) and (rp + Vector3.new(0, 6, 0)) or (rp + dir * 4)
                    snap(root, hitbox, np)
                    rp = np
                end
            end
        end
    end
end)

-- auto pick during intermission
local lastSig = ""
task.spawn(function()
    while running do
        task.wait(1)
        if not CFG.choose or inRound.Value then continue end
        local typ = intermissionType()
        if not typ then continue end
        local prompts = collectPrompts()
        if #prompts == 0 then continue end

        if CFG.debug then
            local parts = {}
            for _, p in ipairs(prompts) do parts[#parts + 1] = promptText(p) end
            local sig = typ .. "|" .. table.concat(parts, ";")
            if sig ~= lastSig then
                lastSig = sig
                local _, rawImg = signImage()
                print("[NullscapeGUI] break type: " .. typ .. " (sign image: " .. tostring(rawImg) .. ")")
                for i, t in ipairs(parts) do print("[NullscapeGUI]   altar " .. i .. ": " .. t) end
            end
        end

        local p, entry, cat = choose(prompts, typ)
        if p then
            state.action = "picking altar (" .. cat .. ")"
            local ok, res = pcall(activate, p)
            if ok and res then
                breakPicks[cat] += 1
                if entry then entry.used += 1 end
                logEvent("picked altar: " .. altarName(p):sub(1, 40))
                if UI["render" .. cat] then UI["render" .. cat]() end
            elseif not ok and CFG.debug then
                warn("[NullscapeGUI] activate error: " .. tostring(res))
            end
            state.action = "idle"
        end
    end
end)

-- beacon
task.spawn(function()
    while running do
        task.wait(0.5)
        if not (CFG.beacon and inRound.Value) then continue end
        local total = need("Gift") + need("GoldenGift") + (CFG.beaconWaitPassage and need("PassageGift") or 0)
        if total > 0 then sawNeed = true end
        local elapsed = tick() - roundStart
        local ready = total <= 0 and elapsed > 8 and (sawNeed or elapsed > CFG.noNeedGrace)
        if ready and tick() - lastExit > 5 then
            lastExit = tick()
            exiting = true
            state.action = "going to beacon"
            notify("Requirements done, going to beacon")
            logEvent("requirements done, going to beacon")
            pcall(goBeacon)
        end
    end
end)

notify("Nullscape GUI loaded. RightShift = show/hide")

end, function(e)
    return tostring(e) .. "\n" .. debug.traceback()
end)

if not __ok then
    warn("[NullscapeGUI] ERROR: " .. tostring(__err))
    pcall(function()
        game:GetService("StarterGui"):SetCore("SendNotification", {
            Title = "Nullscape GUI - error",
            Text = tostring(__err):sub(1, 180),
            Duration = 12,
        })
    end)
    pcall(function()
        local clip = setclipboard or toclipboard or set_clipboard
        if clip then clip(tostring(__err)) end
    end)
end
