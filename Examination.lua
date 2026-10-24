if getgenv and getgenv().RM_Unload then pcall(getgenv().RM_Unload) end
print("[RM] старт")

local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")
local RunService = game:GetService("RunService")
local UIS = game:GetService("UserInputService")
local Lighting = game:GetService("Lighting")
local lp = Players.LocalPlayer

-- Куда класть GUI: пробуем по очереди
local function getParent()
    local ok, res = pcall(function() return gethui and gethui() end)
    if ok and res then return res, "gethui" end
    local ok2, cg = pcall(function() return game:GetService("CoreGui") end)
    if ok2 and cg then return cg, "CoreGui" end
    return lp:WaitForChild("PlayerGui"), "PlayerGui"
end

local guiParent, where = getParent()
print("[RM] родитель GUI:", where)

-- Список неписей (зомби): всё из Workspace.Characters, кроме игроков
local function getZombies()
    local list = {}
    local folder = workspace:FindFirstChild("Characters")
    if not folder then return list end
    for _, m in ipairs(folder:GetChildren()) do
        if m:IsA("Model") and m ~= lp.Character and not Players:GetPlayerFromCharacter(m) then
            table.insert(list, m)
        end
    end
    return list
end

-- ===== Без коллизии / хитбокса (клиентская проверка) =====
-- Ставит CanCollide, CanTouch, CanQuery = false и запоминает старые значения
local function makeGhost(getTargets, interval)
    local orig = setmetatable({}, {__mode = "k"})
    local conn
    local acc = 0
    local function apply()
        for _, root in ipairs(getTargets()) do
            for _, p in ipairs(root:GetDescendants()) do
                if p:IsA("BasePart") then
                    if not orig[p] then
                        orig[p] = {p.CanCollide, p.CanTouch, p.CanQuery}
                    end
                    p.CanCollide = false
                    p.CanTouch = false
                    p.CanQuery = false
                end
            end
        end
    end
    local function start()
        if conn then return end
        conn = RunService.Stepped:Connect(function(_, dt)
            acc = acc + dt
            if acc < interval then return end
            acc = 0
            apply()
        end)
    end
    local function stop()
        if conn then
            conn:Disconnect()
            conn = nil
        end
        for p, o in pairs(orig) do
            if p.Parent then
                p.CanCollide = o[1]
                p.CanTouch = o[2]
                p.CanQuery = o[3]
            end
        end
        table.clear(orig)
    end
    return start, stop
end

local selfGhostStart, selfGhostStop = makeGhost(function()
    return lp.Character and {lp.Character} or {}
end, 0)

local enemyGhostStart, enemyGhostStop = makeGhost(getZombies, 0.25)

-- ===== Ноуклип =====
local noclipConn
local function startNoclip()
    if noclipConn then return end
    noclipConn = RunService.Stepped:Connect(function()
        local char = lp.Character
        if not char then return end
        for _, p in ipairs(char:GetDescendants()) do
            if p:IsA("BasePart") and p.CanCollide then
                p.CanCollide = false
            end
        end
    end)
end

local function stopNoclip()
    if noclipConn then
        noclipConn:Disconnect()
        noclipConn = nil
    end
    local char = lp.Character
    if char then
        for _, p in ipairs(char:GetDescendants()) do
            if p:IsA("BasePart") and (p.Name == "HumanoidRootPart" or p.Name == "Torso" or p.Name == "UpperTorso" or p.Name == "LowerTorso" or p.Name == "Head") then
                p.CanCollide = true
            end
        end
    end
end

-- ===== Безопасная высота (управляемая платформа) =====
local platform, savedCF
local flyConn, savedWalk
local FLY_SPEED = 45 -- скорость платформы, студов в секунду

local function goUp()
    local char = lp.Character
    local root = char and char:FindFirstChild("HumanoidRootPart")
    if not root or platform then return end
    savedCF = root.CFrame

    platform = Instance.new("Part")
    platform.Size = Vector3.new(30, 1, 30)
    platform.Anchored = true
    platform.Transparency = 0.8
    platform.Position = root.Position + Vector3.new(0, 80, 0)
    platform.Parent = workspace

    local hum = char:FindFirstChildOfClass("Humanoid")
    if hum then
        savedWalk = hum.WalkSpeed
        hum.WalkSpeed = 0
    end

    flyConn = RunService.Heartbeat:Connect(function(dt)
        local c = lp.Character
        local r = c and c:FindFirstChild("HumanoidRootPart")
        if not r or not platform then return end

        local dir = Vector3.zero
        if not UIS:GetFocusedTextBox() then
            local cam = workspace.CurrentCamera
            local fwd = Vector3.new(cam.CFrame.LookVector.X, 0, cam.CFrame.LookVector.Z)
            local right = Vector3.new(cam.CFrame.RightVector.X, 0, cam.CFrame.RightVector.Z)
            if fwd.Magnitude > 0.01 then fwd = fwd.Unit end
            if right.Magnitude > 0.01 then right = right.Unit end

            if UIS:IsKeyDown(Enum.KeyCode.W) then dir = dir + fwd end
            if UIS:IsKeyDown(Enum.KeyCode.S) then dir = dir - fwd end
            if UIS:IsKeyDown(Enum.KeyCode.D) then dir = dir + right end
            if UIS:IsKeyDown(Enum.KeyCode.A) then dir = dir - right end
            if UIS:IsKeyDown(Enum.KeyCode.Space) then dir = dir + Vector3.new(0, 1, 0) end
            if UIS:IsKeyDown(Enum.KeyCode.LeftControl) then dir = dir - Vector3.new(0, 1, 0) end
        end

        if dir.Magnitude > 0 then
            platform.Position = platform.Position + dir.Unit * FLY_SPEED * dt
        end

        -- персонаж всегда стоит на платформе
        local rot = r.CFrame - r.CFrame.Position
        r.CFrame = CFrame.new(platform.Position + Vector3.new(0, 3.5, 0)) * rot
        r.AssemblyLinearVelocity = Vector3.zero
    end)
end

local function goDown()
    if not platform and not flyConn then return end
    if flyConn then
        flyConn:Disconnect()
        flyConn = nil
    end
    if platform then
        platform:Destroy()
        platform = nil
    end
    local char = lp.Character
    local root = char and char:FindFirstChild("HumanoidRootPart")
    local hum = char and char:FindFirstChildOfClass("Humanoid")
    if hum and savedWalk then
        hum.WalkSpeed = savedWalk
        savedWalk = nil
    end
    if root and savedCF then
        root.CFrame = savedCF
    end
    savedCF = nil
end

-- ===== Бессмертие =====
local god = false
local conns = {}

local function clearConns()
    for _, c in ipairs(conns) do c:Disconnect() end
    table.clear(conns)
end

local function getHum()
    local char = lp.Character
    return char and char:FindFirstChildOfClass("Humanoid")
end

local function protectChar(char)
    local hum = char:WaitForChild("Humanoid", 5)
    local root = char:WaitForChild("HumanoidRootPart", 5)
    if not hum or not root then return end

    hum:SetStateEnabled(Enum.HumanoidStateType.Dead, false)
    hum:SetStateEnabled(Enum.HumanoidStateType.FallingDown, false)
    hum:SetStateEnabled(Enum.HumanoidStateType.Ragdoll, false)
    hum.MaxHealth = math.huge
    hum.Health = math.huge

    table.insert(conns, hum.HealthChanged:Connect(function()
        if god and hum.Health < hum.MaxHealth then
            hum.Health = hum.MaxHealth
        end
    end))

    table.insert(conns, RunService.Heartbeat:Connect(function()
        if not god then return end
        if hum.Health < hum.MaxHealth then
            hum.Health = hum.MaxHealth
        end
        local v = root.AssemblyLinearVelocity
        if v.Y < -60 then
            root.AssemblyLinearVelocity = Vector3.new(v.X, -60, v.Z)
        end
    end))

    if not char:FindFirstChildOfClass("ForceField") then
        local ff = Instance.new("ForceField")
        ff.Visible = false
        ff.Parent = char
    end
end

local function enableGod()
    clearConns()
    if lp.Character then
        task.spawn(protectChar, lp.Character)
    end
    table.insert(conns, lp.CharacterAdded:Connect(function(char)
        if god then
            task.wait(0.5)
            protectChar(char)
        end
    end))
end

local function disableGod()
    clearConns()
    local char = lp.Character
    local hum = getHum()
    if hum then
        hum:SetStateEnabled(Enum.HumanoidStateType.Dead, true)
        hum:SetStateEnabled(Enum.HumanoidStateType.FallingDown, true)
        hum:SetStateEnabled(Enum.HumanoidStateType.Ragdoll, true)
        hum.MaxHealth = 100
        hum.Health = 100
    end
    local ff = char and char:FindFirstChildOfClass("ForceField")
    if ff then ff:Destroy() end
end

-- ===== Ночное зрение =====
local nvConn, nvCC, nvSaved

local function startNV()
    if nvConn then return end
    nvSaved = {
        Ambient = Lighting.Ambient,
        OutdoorAmbient = Lighting.OutdoorAmbient,
        Brightness = Lighting.Brightness,
        FogEnd = Lighting.FogEnd,
        GlobalShadows = Lighting.GlobalShadows,
    }
    nvCC = Instance.new("ColorCorrectionEffect")
    nvCC.TintColor = Color3.fromRGB(190, 255, 190)
    nvCC.Brightness = 0.05
    nvCC.Contrast = 0.1
    nvCC.Parent = Lighting
    nvConn = RunService.RenderStepped:Connect(function()
        Lighting.Ambient = Color3.fromRGB(150, 150, 150)
        Lighting.OutdoorAmbient = Color3.fromRGB(150, 150, 150)
        Lighting.Brightness = 2
        Lighting.FogEnd = 100000
        Lighting.GlobalShadows = false
    end)
end

local function stopNV()
    if nvConn then
        nvConn:Disconnect()
        nvConn = nil
    end
    if nvCC then
        nvCC:Destroy()
        nvCC = nil
    end
    if nvSaved then
        for k, v in pairs(nvSaved) do
            Lighting[k] = v
        end
        nvSaved = nil
    end
end

-- ===== Бесконечная стамина =====
local stamConn
local stamMax = setmetatable({}, {__mode = "k"})
local stamLogged = {}

local function logOnce(key, text)
    if not stamLogged[key] then
        stamLogged[key] = true
        print("[RM] стамина:", text)
    end
end

local function scanStamina(root)
    for _, inst in ipairs(root:GetDescendants()) do
        if inst:IsA("NumberValue") or inst:IsA("IntValue") then
            local n = string.lower(inst.Name)
            if string.find(n, "stamina", 1, true) and not string.find(n, "max", 1, true) then
                local mx = stamMax[inst] or 100
                if inst.Value > mx then mx = inst.Value end
                local par = inst.Parent
                if par then
                    for _, sib in ipairs(par:GetChildren()) do
                        local sn = string.lower(sib.Name)
                        if (sib:IsA("NumberValue") or sib:IsA("IntValue"))
                            and string.find(sn, "stamina", 1, true) and string.find(sn, "max", 1, true) then
                            mx = sib.Value
                        end
                    end
                end
                stamMax[inst] = mx
                inst.Value = mx
                logOnce(inst, inst:GetFullName())
            end
        end
        for k, v in pairs(inst:GetAttributes()) do
            local kn = string.lower(k)
            if type(v) == "number" and string.find(kn, "stamina", 1, true) and not string.find(kn, "max", 1, true) then
                local mx = 100
                local key = tostring(inst) .. k
                if stamMax[key] then mx = stamMax[key] end
                if v > mx then mx = v end
                for k2, v2 in pairs(inst:GetAttributes()) do
                    local k2n = string.lower(k2)
                    if type(v2) == "number" and string.find(k2n, "stamina", 1, true) and string.find(k2n, "max", 1, true) then
                        mx = v2
                    end
                end
                stamLogged[key] = stamLogged[key] or false
                inst:SetAttribute(k, mx)
                logOnce(key, inst:GetFullName() .. " [атрибут " .. k .. "]")
            end
        end
    end
end

local function startStamina()
    if stamConn then return end
    local acc = 0
    stamConn = RunService.Heartbeat:Connect(function(dt)
        acc = acc + dt
        if acc < 0.15 then return end
        acc = 0
        scanStamina(lp)
        if lp.Character then scanStamina(lp.Character) end
    end)
end

local function stopStamina()
    if stamConn then
        stamConn:Disconnect()
        stamConn = nil
    end
end

-- ===== Заставка =====
local introGui = Instance.new("ScreenGui")
introGui.Name = "IntroGui"
introGui.IgnoreGuiInset = true
introGui.ResetOnSpawn = false
introGui.Parent = guiParent

local introLabel = Instance.new("TextLabel")
introLabel.Size = UDim2.new(1, 0, 1, 0)
introLabel.BackgroundTransparency = 1
introLabel.Text = "Rip_Moriarty"
introLabel.Font = Enum.Font.GothamBold
introLabel.TextSize = 56
introLabel.TextColor3 = Color3.fromRGB(255, 255, 255)
introLabel.TextTransparency = 1
introLabel.Parent = introGui
print("[RM] заставка создана")

local info = TweenInfo.new(1, Enum.EasingStyle.Quad)
TweenService:Create(introLabel, info, {TextTransparency = 0}):Play()
task.wait(2.5)
TweenService:Create(introLabel, info, {TextTransparency = 1}):Play()
task.wait(1.1)
introGui:Destroy()
print("[RM] заставка закончилась")

-- ===== GUI: каркас =====
local GREEN = Color3.fromRGB(40, 150, 70)
local RED = Color3.fromRGB(150, 40, 40)

local gui = Instance.new("ScreenGui")
gui.Name = "ExaminationGUI"
gui.ResetOnSpawn = false
gui.Parent = guiParent

local frame = Instance.new("Frame")
frame.Size = UDim2.new(0, 270, 0, 430)
frame.Position = UDim2.new(0.5, -135, 0.25, 0)
frame.BackgroundColor3 = Color3.fromRGB(25, 25, 30)
frame.BorderSizePixel = 0
frame.Active = true
frame.Draggable = true
frame.Parent = gui
Instance.new("UICorner", frame).CornerRadius = UDim.new(0, 10)

local title = Instance.new("TextLabel")
title.Size = UDim2.new(1, 0, 0, 36)
title.BackgroundTransparency = 1
title.Text = "Examination GUI"
title.Font = Enum.Font.GothamBold
title.TextSize = 18
title.TextColor3 = Color3.fromRGB(255, 255, 255)
title.Parent = frame

local function newPage()
    local sf = Instance.new("ScrollingFrame")
    sf.Size = UDim2.new(1, -20, 1, -92)
    sf.Position = UDim2.new(0, 10, 0, 82)
    sf.BackgroundTransparency = 1
    sf.BorderSizePixel = 0
    sf.ScrollBarThickness = 4
    sf.CanvasSize = UDim2.new(0, 0, 0, 0)
    sf.AutomaticCanvasSize = Enum.AutomaticSize.Y
    sf.Visible = false
    sf.Parent = frame
    local layout = Instance.new("UIListLayout")
    layout.Padding = UDim.new(0, 6)
    layout.SortOrder = Enum.SortOrder.LayoutOrder
    layout.Parent = sf
    return sf
end

local pages, tabBtns = {}, {}
local tabNames = {"Основное", "ESP"}

local function selectTab(i)
    for j, p in ipairs(pages) do
        p.Visible = (j == i)
        tabBtns[j].BackgroundColor3 = (j == i) and Color3.fromRGB(70, 70, 130) or Color3.fromRGB(40, 40, 48)
    end
end

for i, n in ipairs(tabNames) do
    local b = Instance.new("TextButton")
    b.Size = UDim2.new(0.5, -14, 0, 30)
    b.Position = UDim2.new((i - 1) * 0.5, (i == 1) and 10 or 4, 0, 42)
    b.BackgroundColor3 = Color3.fromRGB(40, 40, 48)
    b.Text = n
    b.Font = Enum.Font.GothamMedium
    b.TextSize = 15
    b.TextColor3 = Color3.fromRGB(255, 255, 255)
    b.Parent = frame
    Instance.new("UICorner", b).CornerRadius = UDim.new(0, 8)
    tabBtns[i] = b
    pages[i] = newPage()
    b.MouseButton1Click:Connect(function() selectTab(i) end)
end

local mainPage, espPage = pages[1], pages[2]

local function makeToggle(page, name, order, onFn, offFn)
    local b = Instance.new("TextButton")
    b.Size = UDim2.new(1, -6, 0, 40)
    b.LayoutOrder = order
    b.BackgroundColor3 = RED
    b.Text = name .. ": ВЫКЛ"
    b.Font = Enum.Font.GothamMedium
    b.TextSize = 15
    b.TextColor3 = Color3.fromRGB(255, 255, 255)
    b.Parent = page
    Instance.new("UICorner", b).CornerRadius = UDim.new(0, 8)
    local state = false
    b.MouseButton1Click:Connect(function()
        state = not state
        if state then
            onFn()
            b.Text = name .. ": ВКЛ"
            b.BackgroundColor3 = GREEN
        else
            offFn()
            b.Text = name .. ": ВЫКЛ"
            b.BackgroundColor3 = RED
        end
    end)
    return b
end

-- ===== ESP зомби =====
local espOn = false
local espTypes = {}   -- [имя] = {on, color, order, count, label}
local espObjs = {}    -- [модель] = {hl, bb, txt}
local typeOrder = 0
local MAX_HIGHLIGHTS = 30 -- лимит Roblox на одновременные Highlight около 31

local palette = {
    Color3.fromRGB(255, 80, 80),
    Color3.fromRGB(255, 170, 40),
    Color3.fromRGB(255, 235, 60),
    Color3.fromRGB(90, 220, 90),
    Color3.fromRGB(70, 200, 255),
    Color3.fromRGB(170, 110, 255),
    Color3.fromRGB(255, 110, 200),
    Color3.fromRGB(230, 230, 230),
}

local function registerType(name)
    typeOrder = typeOrder + 1
    local infoT = {
        on = true,
        color = palette[(typeOrder - 1) % #palette + 1],
        order = typeOrder,
        count = 0,
    }
    espTypes[name] = infoT

    local row = Instance.new("Frame")
    row.Size = UDim2.new(1, -6, 0, 34)
    row.LayoutOrder = typeOrder
    row.BackgroundColor3 = Color3.fromRGB(35, 35, 42)
    row.BorderSizePixel = 0
    row.Parent = espPage
    Instance.new("UICorner", row).CornerRadius = UDim.new(0, 8)

    local sw = Instance.new("Frame")
    sw.Size = UDim2.new(0, 6, 1, -12)
    sw.Position = UDim2.new(0, 8, 0, 6)
    sw.BackgroundColor3 = infoT.color
    sw.BorderSizePixel = 0
    sw.Parent = row
    Instance.new("UICorner", sw).CornerRadius = UDim.new(0, 3)

    local lbl = Instance.new("TextLabel")
    lbl.Size = UDim2.new(1, -96, 1, 0)
    lbl.Position = UDim2.new(0, 22, 0, 0)
    lbl.BackgroundTransparency = 1
    lbl.Text = name .. " (0)"
    lbl.Font = Enum.Font.GothamMedium
    lbl.TextSize = 14
    lbl.TextXAlignment = Enum.TextXAlignment.Left
    lbl.TextTruncate = Enum.TextTruncate.AtEnd
    lbl.TextColor3 = Color3.fromRGB(255, 255, 255)
    lbl.Parent = row
    infoT.label = lbl

    local tb = Instance.new("TextButton")
    tb.Size = UDim2.new(0, 60, 0, 24)
    tb.Position = UDim2.new(1, -66, 0.5, -12)
    tb.BackgroundColor3 = GREEN
    tb.Text = "ВКЛ"
    tb.Font = Enum.Font.GothamMedium
    tb.TextSize = 13
    tb.TextColor3 = Color3.fromRGB(255, 255, 255)
    tb.Parent = row
    Instance.new("UICorner", tb).CornerRadius = UDim.new(0, 6)
    tb.MouseButton1Click:Connect(function()
        infoT.on = not infoT.on
        tb.Text = infoT.on and "ВКЛ" or "ВЫКЛ"
        tb.BackgroundColor3 = infoT.on and GREEN or RED
    end)

    print("[RM] новый тип зомби:", name)
    return infoT
end

local function clearObj(m)
    local o = espObjs[m]
    if o then
        if o.hl then o.hl:Destroy() end
        if o.bb then o.bb:Destroy() end
        espObjs[m] = nil
    end
end

local function espStep()
    local myRoot = lp.Character and lp.Character:FindFirstChild("HumanoidRootPart")
    local counts = {}
    local cands = {}

    for _, m in ipairs(getZombies()) do
        local hum = m:FindFirstChildOfClass("Humanoid")
        local part = m:FindFirstChild("HumanoidRootPart") or m.PrimaryPart or m:FindFirstChildWhichIsA("BasePart")
        if part and not (hum and hum.Health <= 0) then
            local name = m.Name
            local t = espTypes[name] or registerType(name)
            counts[name] = (counts[name] or 0) + 1
            if espOn and t.on then
                local d = myRoot and (myRoot.Position - part.Position).Magnitude or 0
                table.insert(cands, {m = m, part = part, t = t, d = d, name = name})
            end
        end
    end

    for name, t in pairs(espTypes) do
        t.count = counts[name] or 0
        t.label.Text = name .. " (" .. t.count .. ")"
    end

    table.sort(cands, function(a, b) return a.d < b.d end)

    local seen = {}
    for i, c in ipairs(cands) do
        seen[c.m] = true
        local o = espObjs[c.m]
        if not o then
            o = {}
            espObjs[c.m] = o
        end

        if not o.bb or not o.bb.Parent then
            local bb = Instance.new("BillboardGui")
            bb.AlwaysOnTop = true
            bb.Size = UDim2.new(0, 170, 0, 34)
            bb.StudsOffset = Vector3.new(0, 3.5, 0)
            bb.ResetOnSpawn = false
            bb.Parent = guiParent
            local tl = Instance.new("TextLabel")
            tl.Size = UDim2.new(1, 0, 1, 0)
            tl.BackgroundTransparency = 1
            tl.Font = Enum.Font.GothamBold
            tl.TextSize = 14
            tl.TextStrokeTransparency = 0
            tl.Parent = bb
            o.bb = bb
            o.txt = tl
        end
        o.bb.Adornee = c.part
        o.txt.TextColor3 = c.t.color
        o.txt.Text = c.name .. " [" .. math.floor(c.d) .. "m]"

        if i <= MAX_HIGHLIGHTS then
            if not o.hl or not o.hl.Parent then
                local hl = Instance.new("Highlight")
                hl.FillTransparency = 0.6
                hl.OutlineTransparency = 0
                hl.DepthMode = Enum.HighlightDepthMode.AlwaysOnTop
                hl.Parent = guiParent
                o.hl = hl
            end
            o.hl.Adornee = c.m
            o.hl.FillColor = c.t.color
            o.hl.OutlineColor = c.t.color
        elseif o.hl then
            o.hl:Destroy()
            o.hl = nil
        end
    end

    for m in pairs(espObjs) do
        if not seen[m] then clearObj(m) end
    end
end

local espAcc = 0
local espLoop = RunService.Heartbeat:Connect(function(dt)
    espAcc = espAcc + dt
    if espAcc < 0.3 then return end
    espAcc = 0
    local ok, err = pcall(espStep)
    if not ok then warn("[RM] esp:", err) end
end)

makeToggle(espPage, "ESP зомби", 0, function() espOn = true end, function() espOn = false end)

-- ===== Основная вкладка =====
makeToggle(mainPage, "Бессмертие", 1,
    function() god = true enableGod() end,
    function() god = false disableGod() end)
makeToggle(mainPage, "Без коллизии (я)", 2, selfGhostStart, selfGhostStop)
makeToggle(mainPage, "Без коллизии (враги)", 3, enemyGhostStart, enemyGhostStop)
makeToggle(mainPage, "Подняться", 4, goUp, goDown)
makeToggle(mainPage, "Ноуклип", 5, startNoclip, stopNoclip)
makeToggle(mainPage, "Ночное зрение", 6, startNV, stopNV)
makeToggle(mainPage, "Стамина", 7, startStamina, stopStamina)

-- Клавиша сворачивания меню
local menuKey = Enum.KeyCode.RightShift
local binding = false

local bindBtn = Instance.new("TextButton")
bindBtn.Size = UDim2.new(1, -6, 0, 40)
bindBtn.LayoutOrder = 8
bindBtn.BackgroundColor3 = Color3.fromRGB(60, 60, 150)
bindBtn.Text = "Скрыть меню: RightShift (нажми, чтобы сменить)"
bindBtn.TextWrapped = true
bindBtn.Font = Enum.Font.GothamMedium
bindBtn.TextSize = 13
bindBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
bindBtn.Parent = mainPage
Instance.new("UICorner", bindBtn).CornerRadius = UDim.new(0, 8)

bindBtn.MouseButton1Click:Connect(function()
    binding = true
    bindBtn.Text = "Нажми любую клавишу..."
end)

local bindConn = UIS.InputBegan:Connect(function(input, gp)
    if binding and input.UserInputType == Enum.UserInputType.Keyboard then
        menuKey = input.KeyCode
        binding = false
        bindBtn.Text = "Скрыть меню: " .. menuKey.Name .. " (нажми, чтобы сменить)"
        return
    end
    if gp then return end
    if input.KeyCode == menuKey then
        gui.Enabled = not gui.Enabled
    end
end)

selectTab(1)

-- Полная выгрузка при повторном запуске
local function unload()
    god = false
    pcall(disableGod)
    pcall(stopNoclip)
    pcall(goDown)
    pcall(stopNV)
    pcall(stopStamina)
    pcall(selfGhostStop)
    pcall(enemyGhostStop)
    espOn = false
    if espLoop then espLoop:Disconnect() end
    if bindConn then bindConn:Disconnect() end
    for m in pairs(espObjs) do clearObj(m) end
    if gui then gui:Destroy() end
end
if getgenv then getgenv().RM_Unload = unload end

print("[RM] GUI готов, скрыть/показать меню: RightShift")
