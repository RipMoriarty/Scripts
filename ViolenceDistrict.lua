--[[
    District GUI | Violence District
    Автор интро: Rip_Moriarty
    Запуск: вставить в Potassium и нажать Execute
    Скрыть/показать меню: RightShift
]]

-- ================== НАСТРОЙКИ ==================
local RUN_MAX = 4              -- максимум множителя скорости (x)
local DANCES = {               -- стандартные танцы Roblox, тип рига определяется автоматически
    {name = "Dance 1", r6 = "rbxassetid://182435998", r15 = "rbxassetid://507771019"},
    {name = "Dance 2", r6 = "rbxassetid://182436842", r15 = "rbxassetid://507776043"},
    {name = "Dance 3", r6 = "rbxassetid://182436935", r15 = "rbxassetid://507777268"},
}

-- Как ESP ищет объекты на карте (по части имени, без учёта регистра).
-- Если что-то не подсвечивается, поменяй слова под реальные названия в игре.
local OBJECT_PATTERNS = {
    Generators = {"generator"},
    Pallets    = {"pallet"},
    Windows    = {"window"},
}
-- Слова в названии команды/роли, по которым определяется киллер
local KILLER_WORDS = {"killer", "murderer", "maniac"}

local ESP_COLORS = {
    Killer     = Color3.fromRGB(255, 40, 40),
    Survivors  = Color3.fromRGB(60, 255, 120),
    Generators = Color3.fromRGB(255, 230, 60),
    Pallets    = Color3.fromRGB(255, 150, 40),
    Windows    = Color3.fromRGB(70, 180, 255),
}
-- ================================================

local Players          = game:GetService("Players")
local RunService       = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local TweenService     = game:GetService("TweenService")

local LP = Players.LocalPlayer

-- защита от двойного запуска
local guiParent = (gethui and gethui()) or game:GetService("CoreGui")
pcall(function()
    for _, n in ipairs({"DistrictGUI", "DistrictESP"}) do
        local old = guiParent:FindFirstChild(n)
        if old then old:Destroy() end
    end
end)

local screen = Instance.new("ScreenGui")
screen.Name = "DistrictGUI"
screen.ResetOnSpawn = false
screen.IgnoreGuiInset = true
screen.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
local ok = pcall(function() screen.Parent = guiParent end)
if not ok then screen.Parent = LP:WaitForChild("PlayerGui") end

local espFolder = Instance.new("Folder")
espFolder.Name = "DistrictESP"
local ok2 = pcall(function() espFolder.Parent = guiParent end)
if not ok2 then espFolder.Parent = workspace end

-- ================== СОСТОЯНИЕ ==================
local runMult = 1
local noclipOn, danceOn = false, false
local danceIndex = 1
local danceTrack
local gameSpeed, lastTarget = 16, nil
local hookedHum

local esp = {Killer = false, Survivors = false, Generators = false, Pallets = false, Windows = false}

local function getChar() return LP.Character end
local function getHum()
    local c = getChar()
    return c and c:FindFirstChildOfClass("Humanoid")
end

-- ================== ИНТРО ==================
local intro = Instance.new("TextLabel")
intro.Size = UDim2.fromScale(1, 0.2)
intro.Position = UDim2.fromScale(0, 0.4)
intro.BackgroundTransparency = 1
intro.Text = "Rip_Moriarty"
intro.Font = Enum.Font.GothamBlack
intro.TextSize = 64
intro.TextColor3 = Color3.fromRGB(220, 30, 50)
intro.TextStrokeTransparency = 0.3
intro.TextTransparency = 1
intro.Parent = screen

TweenService:Create(intro, TweenInfo.new(0.8), {TextTransparency = 0}):Play()
task.wait(2.2)
local fadeOut = TweenService:Create(intro, TweenInfo.new(0.8), {TextTransparency = 1, TextStrokeTransparency = 1})
fadeOut:Play()
fadeOut.Completed:Wait()
intro:Destroy()

-- ================== GUI ==================
local BG     = Color3.fromRGB(18, 18, 24)
local PANEL  = Color3.fromRGB(30, 30, 40)
local ACCENT = Color3.fromRGB(220, 30, 50)
local TEXT   = Color3.fromRGB(235, 235, 240)

local main = Instance.new("Frame")
main.Name = "Main"
main.Size = UDim2.fromOffset(270, 280)
main.Position = UDim2.new(0.5, -135, 0.5, -140)
main.BackgroundColor3 = BG
main.BorderSizePixel = 0
main.Active = true
main.Parent = screen
Instance.new("UICorner", main).CornerRadius = UDim.new(0, 10)
local stroke = Instance.new("UIStroke", main)
stroke.Color = ACCENT
stroke.Thickness = 1.5

local title = Instance.new("TextLabel")
title.Size = UDim2.new(1, -40, 0, 34)
title.Position = UDim2.fromOffset(12, 0)
title.BackgroundTransparency = 1
title.Text = "District GUI"
title.Font = Enum.Font.GothamBold
title.TextSize = 16
title.TextColor3 = TEXT
title.TextXAlignment = Enum.TextXAlignment.Left
title.Parent = main

local closeBtn = Instance.new("TextButton")
closeBtn.Size = UDim2.fromOffset(26, 26)
closeBtn.Position = UDim2.new(1, -32, 0, 4)
closeBtn.BackgroundColor3 = PANEL
closeBtn.Text = "X"
closeBtn.Font = Enum.Font.GothamBold
closeBtn.TextSize = 14
closeBtn.TextColor3 = TEXT
closeBtn.Parent = main
Instance.new("UICorner", closeBtn).CornerRadius = UDim.new(0, 6)

-- перетаскивание за заголовок
do
    local dragging, dragStart, startPos
    main.InputBegan:Connect(function(i)
        if i.UserInputType == Enum.UserInputType.MouseButton1 or i.UserInputType == Enum.UserInputType.Touch then
            if i.Position.Y - main.AbsolutePosition.Y <= 34 then
                dragging, dragStart, startPos = true, i.Position, main.Position
            end
        end
    end)
    UserInputService.InputChanged:Connect(function(i)
        if dragging and (i.UserInputType == Enum.UserInputType.MouseMovement or i.UserInputType == Enum.UserInputType.Touch) then
            local d = i.Position - dragStart
            main.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + d.X, startPos.Y.Scale, startPos.Y.Offset + d.Y)
        end
    end)
    UserInputService.InputEnded:Connect(function(i)
        if i.UserInputType == Enum.UserInputType.MouseButton1 or i.UserInputType == Enum.UserInputType.Touch then
            dragging = false
        end
    end)
end

-- ---------- вкладки ----------
local pages = {}
local tabButtons = {}

local function makePage(name)
    local f = Instance.new("Frame")
    f.Name = name
    f.Size = UDim2.new(1, 0, 1, -72)
    f.Position = UDim2.fromOffset(0, 72)
    f.BackgroundTransparency = 1
    f.Visible = false
    f.Parent = main
    pages[name] = f
    return f
end

local function showPage(name)
    for n, f in pairs(pages) do f.Visible = (n == name) end
    for n, b in pairs(tabButtons) do b.BackgroundColor3 = (n == name) and ACCENT or PANEL end
end

local function makeTab(name, text, x)
    local b = Instance.new("TextButton")
    b.Size = UDim2.new(0.5, -16, 0, 28)
    b.Position = UDim2.new(x, x == 0 and 12 or 4, 0, 36)
    b.BackgroundColor3 = PANEL
    b.Text = text
    b.Font = Enum.Font.GothamBold
    b.TextSize = 13
    b.TextColor3 = TEXT
    b.Parent = main
    Instance.new("UICorner", b).CornerRadius = UDim.new(0, 8)
    b.MouseButton1Click:Connect(function() showPage(name) end)
    tabButtons[name] = b
end

local mainPage = makePage("Main")
local espPage  = makePage("ESP")
makeTab("Main", "Основное", 0)
makeTab("ESP", "ESP", 0.5)

-- ---------- элементы ----------
local function makeSlider(parent, y, label, min, max, callback)
    local holder = Instance.new("Frame")
    holder.Size = UDim2.new(1, -24, 0, 48)
    holder.Position = UDim2.fromOffset(12, y)
    holder.BackgroundColor3 = PANEL
    holder.Parent = parent
    Instance.new("UICorner", holder).CornerRadius = UDim.new(0, 8)

    local lbl = Instance.new("TextLabel")
    lbl.Size = UDim2.new(1, -16, 0, 20)
    lbl.Position = UDim2.fromOffset(8, 4)
    lbl.BackgroundTransparency = 1
    lbl.Font = Enum.Font.Gotham
    lbl.TextSize = 13
    lbl.TextColor3 = TEXT
    lbl.TextXAlignment = Enum.TextXAlignment.Left
    lbl.Text = label .. ": x1.0"
    lbl.Parent = holder

    local bar = Instance.new("Frame")
    bar.Size = UDim2.new(1, -16, 0, 6)
    bar.Position = UDim2.fromOffset(8, 32)
    bar.BackgroundColor3 = Color3.fromRGB(55, 55, 70)
    bar.BorderSizePixel = 0
    bar.Parent = holder
    Instance.new("UICorner", bar).CornerRadius = UDim.new(1, 0)

    local fill = Instance.new("Frame")
    fill.Size = UDim2.fromScale(0, 1)
    fill.BackgroundColor3 = ACCENT
    fill.BorderSizePixel = 0
    fill.Parent = bar
    Instance.new("UICorner", fill).CornerRadius = UDim.new(1, 0)

    local knob = Instance.new("Frame")
    knob.Size = UDim2.fromOffset(14, 14)
    knob.AnchorPoint = Vector2.new(0.5, 0.5)
    knob.Position = UDim2.fromScale(0, 0.5)
    knob.BackgroundColor3 = TEXT
    knob.BorderSizePixel = 0
    knob.Parent = bar
    Instance.new("UICorner", knob).CornerRadius = UDim.new(1, 0)

    local function setFromX(x)
        local a = math.clamp((x - bar.AbsolutePosition.X) / bar.AbsoluteSize.X, 0, 1)
        local val = math.floor((min + (max - min) * a) * 10 + 0.5) / 10
        fill.Size = UDim2.fromScale(a, 1)
        knob.Position = UDim2.fromScale(a, 0.5)
        lbl.Text = string.format("%s: x%.1f", label, val)
        callback(val)
    end

    local sliding = false
    holder.InputBegan:Connect(function(i)
        if i.UserInputType == Enum.UserInputType.MouseButton1 or i.UserInputType == Enum.UserInputType.Touch then
            sliding = true
            setFromX(i.Position.X)
        end
    end)
    UserInputService.InputChanged:Connect(function(i)
        if sliding and (i.UserInputType == Enum.UserInputType.MouseMovement or i.UserInputType == Enum.UserInputType.Touch) then
            setFromX(i.Position.X)
        end
    end)
    UserInputService.InputEnded:Connect(function(i)
        if i.UserInputType == Enum.UserInputType.MouseButton1 or i.UserInputType == Enum.UserInputType.Touch then
            sliding = false
        end
    end)
end

local function makeButton(parent, y, text, callback)
    local b = Instance.new("TextButton")
    b.Size = UDim2.new(1, -24, 0, 34)
    b.Position = UDim2.fromOffset(12, y)
    b.BackgroundColor3 = PANEL
    b.Text = text
    b.Font = Enum.Font.GothamBold
    b.TextSize = 14
    b.TextColor3 = TEXT
    b.AutoButtonColor = true
    b.Parent = parent
    Instance.new("UICorner", b).CornerRadius = UDim.new(0, 8)
    b.MouseButton1Click:Connect(function() callback(b) end)
    return b
end

local function setState(btn, name, on)
    btn.Text = name .. ": " .. (on and "ВКЛ" or "ВЫКЛ")
    btn.BackgroundColor3 = on and ACCENT or PANEL
end

local function makeToggle(parent, y, name, initial, onChange)
    local state = initial
    local btn = makeButton(parent, y, "", function(b)
        state = not state
        setState(b, name, state)
        onChange(state)
    end)
    setState(btn, name, state)
    return btn
end

-- ---------- вкладка "Основное" ----------
makeSlider(mainPage, 4, "Скорость", 1, RUN_MAX, function(v) runMult = v end)

makeToggle(mainPage, 60, "Танец", false, function(on)
    danceOn = on
    if not on and danceTrack then
        danceTrack:Stop()
        danceTrack = nil
    end
end)

makeButton(mainPage, 100, "Сменить танец: " .. DANCES[1].name, function(btn)
    danceIndex = danceIndex % #DANCES + 1
    btn.Text = "Сменить танец: " .. DANCES[danceIndex].name
    if danceTrack then danceTrack:Stop(); danceTrack = nil end
end)

makeToggle(mainPage, 140, "Noclip", false, function(on) noclipOn = on end)

-- ---------- вкладка ESP (кнопки привязываются ниже) ----------
local espRefreshObjects -- объявлена заранее, определяется в блоке ESP

local espLabels = {
    {"Killer",     "Киллер"},
    {"Survivors",  "Сурвы"},
    {"Generators", "Генераторы"},
    {"Pallets",    "Паллеты"},
    {"Windows",    "Окна"},
}
for idx, item in ipairs(espLabels) do
    local key, text = item[1], item[2]
    makeToggle(espPage, 4 + (idx - 1) * 38, text, false, function(on)
        esp[key] = on
        if espRefreshObjects then espRefreshObjects() end
    end)
end

showPage("Main")

closeBtn.MouseButton1Click:Connect(function() main.Visible = false end)
UserInputService.InputBegan:Connect(function(i, gp)
    if not gp and i.KeyCode == Enum.KeyCode.RightShift then
        main.Visible = not main.Visible
    end
end)

-- ================== ЛОГИКА: СКОРОСТЬ / ТАНЕЦ ==================

-- Запоминаем скорость, которую выставляет сама игра, и умножаем её на ползунок
-- (работает и на бегу, и в лежачем состоянии)
local function hookHumanoid(hum)
    if hookedHum == hum then return end
    hookedHum = hum
    gameSpeed, lastTarget = hum.WalkSpeed, nil
    hum:GetPropertyChangedSignal("WalkSpeed"):Connect(function()
        if lastTarget and math.abs(hum.WalkSpeed - lastTarget) < 0.01 then return end
        gameSpeed = hum.WalkSpeed
    end)
end

RunService.Heartbeat:Connect(function()
    local hum = getHum()
    if not hum then return end
    hookHumanoid(hum)

    -- скорость
    if runMult ~= 1 then
        local target = gameSpeed * runMult
        lastTarget = target
        if hum.WalkSpeed ~= target then hum.WalkSpeed = target end
    elseif lastTarget and math.abs(hum.WalkSpeed - lastTarget) < 0.01 then
        hum.WalkSpeed = gameSpeed
        lastTarget = nil
    end

    -- танец (постоянно, реплицируется на других игроков через Animator)
    if danceOn then
        if not danceTrack or danceTrack.Parent == nil then
            local animator = hum:FindFirstChildOfClass("Animator") or hum:WaitForChild("Animator", 2)
            if animator then
                local anim = Instance.new("Animation")
                local isR6 = hum.RigType == Enum.HumanoidRigType.R6
                anim.AnimationId = isR6 and DANCES[danceIndex].r6 or DANCES[danceIndex].r15
                danceTrack = animator:LoadAnimation(anim)
                danceTrack.Looped = true
                danceTrack.Priority = Enum.AnimationPriority.Action4
            end
        end
        if danceTrack and not danceTrack.IsPlaying then
            danceTrack:Play()
        end
    end
end)

LP.CharacterAdded:Connect(function()
    danceTrack = nil
    hookedHum = nil
end)

-- Noclip
RunService.Stepped:Connect(function()
    if not noclipOn then return end
    local char = getChar()
    if not char then return end
    for _, p in ipairs(char:GetDescendants()) do
        if p:IsA("BasePart") and p.CanCollide then
            p.CanCollide = false
        end
    end
end)

-- ================== ЛОГИКА: ESP ==================

local function makeLabel(adornee, text, color)
    local bb = Instance.new("BillboardGui")
    bb.Adornee = adornee
    bb.AlwaysOnTop = true
    bb.Size = UDim2.fromOffset(120, 18)
    bb.StudsOffset = Vector3.new(0, 3, 0)
    bb.Enabled = false
    local t = Instance.new("TextLabel")
    t.Size = UDim2.fromScale(1, 1)
    t.BackgroundTransparency = 1
    t.Text = text
    t.Font = Enum.Font.GothamBold
    t.TextSize = 12
    t.TextColor3 = color
    t.TextStrokeTransparency = 0.3
    t.Parent = bb
    bb.Parent = espFolder
    return bb, t
end

local function getMainPart(inst)
    if inst:IsA("BasePart") then return inst end
    if inst:IsA("Model") then
        if inst.PrimaryPart then return inst.PrimaryPart end
        return inst:FindFirstChildWhichIsA("BasePart", true)
    end
end

-- ----- игроки (киллер / сурвы) -----
local function matchesKiller(v)
    if type(v) ~= "string" then return false end
    v = v:lower()
    for _, w in ipairs(KILLER_WORDS) do
        if v:find(w, 1, true) then return true end
    end
    return false
end

local function isKiller(plr)
    local team = plr.Team
    if team and matchesKiller(team.Name) then return true end
    if matchesKiller(plr:GetAttribute("Role")) or matchesKiller(plr:GetAttribute("Team")) then return true end
    local char = plr.Character
    if char and (matchesKiller(char:GetAttribute("Role")) or matchesKiller(char:GetAttribute("Team"))) then return true end
    return false
end

local playerObjs = {}

local function removePlayerEsp(plr)
    local e = playerObjs[plr]
    if e then
        e.hl:Destroy()
        e.label:Destroy()
        playerObjs[plr] = nil
    end
end

local function updatePlayers()
    for plr in pairs(playerObjs) do
        if not plr.Parent then removePlayerEsp(plr) end
    end
    for _, plr in ipairs(Players:GetPlayers()) do
        if plr ~= LP then
            local char = plr.Character
            local e = playerObjs[plr]
            if e and e.char ~= char then
                removePlayerEsp(plr)
                e = nil
            end
            if char and not e then
                local part = char:FindFirstChild("Head") or char:FindFirstChild("HumanoidRootPart") or getMainPart(char)
                if part then
                    local hl = Instance.new("Highlight")
                    hl.Adornee = char
                    hl.DepthMode = Enum.HighlightDepthMode.AlwaysOnTop
                    hl.FillTransparency = 0.65
                    hl.OutlineTransparency = 0
                    hl.Enabled = false
                    hl.Parent = espFolder
                    local label, textLabel = makeLabel(part, plr.Name, Color3.new(1, 1, 1))
                    e = {char = char, hl = hl, label = label, text = textLabel}
                    playerObjs[plr] = e
                end
            end
            if e then
                local role = isKiller(plr) and "Killer" or "Survivors"
                local on = esp[role]
                local color = ESP_COLORS[role]
                e.hl.Enabled = on
                e.hl.FillColor = color
                e.hl.OutlineColor = color
                e.label.Enabled = on
                e.text.TextColor3 = color
                e.text.Text = (role == "Killer" and "[Киллер] " or "") .. plr.Name
            end
        end
    end
end

task.spawn(function()
    while screen.Parent do
        if esp.Killer or esp.Survivors or next(playerObjs) then
            pcall(updatePlayers)
        end
        task.wait(0.4)
    end
end)

Players.PlayerRemoving:Connect(removePlayerEsp)

-- ----- объекты карты (генераторы / паллеты / окна) -----
local tracked = {}
local objectsScanned = false

local function classify(inst)
    if not (inst:IsA("Model") or inst:IsA("BasePart")) then return nil end
    local n = inst.Name:lower()
    for kind, pats in pairs(OBJECT_PATTERNS) do
        for _, p in ipairs(pats) do
            if n:find(p, 1, true) then return kind end
        end
    end
end

local function removeObject(inst)
    local e = tracked[inst]
    if e then
        e.box:Destroy()
        e.label:Destroy()
        tracked[inst] = nil
    end
end

local function considerObject(inst)
    if tracked[inst] then return end
    local kind = classify(inst)
    if not kind then return end

    -- не трогаем игроков и части уже найденных объектов
    local p = inst.Parent
    while p and p ~= workspace do
        if tracked[p] or Players:GetPlayerFromCharacter(p) then return end
        p = p.Parent
    end

    local part = getMainPart(inst)
    if not part then return end

    local cf, size
    if inst:IsA("Model") then
        cf, size = inst:GetBoundingBox()
    else
        cf, size = inst.CFrame, inst.Size
    end

    local color = ESP_COLORS[kind]
    local box = Instance.new("BoxHandleAdornment")
    box.Adornee = part
    box.Size = size
    box.CFrame = part.CFrame:ToObjectSpace(cf)
    box.AlwaysOnTop = true
    box.ZIndex = 5
    box.Transparency = 0.65
    box.Color3 = color
    box.Visible = esp[kind]
    box.Parent = espFolder

    local names = {Generators = "Генератор", Pallets = "Паллета", Windows = "Окно"}
    local label = makeLabel(part, names[kind], color)
    label.Enabled = esp[kind]

    tracked[inst] = {kind = kind, box = box, label = label}
    inst.AncestryChanged:Connect(function(_, parent)
        if not parent then removeObject(inst) end
    end)
end

local function scanObjects()
    if objectsScanned then return end
    objectsScanned = true
    workspace.DescendantAdded:Connect(function(d)
        task.defer(considerObject, d)
    end)
    task.spawn(function()
        local n = 0
        for _, d in ipairs(workspace:GetDescendants()) do
            pcall(considerObject, d)
            n += 1
            if n % 300 == 0 then task.wait() end
        end
    end)
end

espRefreshObjects = function()
    if esp.Generators or esp.Pallets or esp.Windows then
        scanObjects()
    end
    for _, e in pairs(tracked) do
        local on = esp[e.kind]
        e.box.Visible = on
        e.label.Enabled = on
    end
end
