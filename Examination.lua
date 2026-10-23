print("[RM] старт")

local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")
local RunService = game:GetService("RunService")
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

-- ===== Безопасная высота =====
local platform, savedCF

local UIS = game:GetService("UserInputService")
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
local Lighting = game:GetService("Lighting")
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

-- ===== GUI =====
local gui = Instance.new("ScreenGui")
gui.Name = "ExaminationGUI"
gui.ResetOnSpawn = false
gui.Parent = guiParent

local frame = Instance.new("Frame")
frame.Size = UDim2.new(0, 240, 0, 338)
frame.Position = UDim2.new(0.5, -120, 0.4, 0)
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

-- Кнопка 1: бессмертие
local btn = Instance.new("TextButton")
btn.Size = UDim2.new(1, -30, 0, 44)
btn.Position = UDim2.new(0, 15, 0, 50)
btn.BackgroundColor3 = Color3.fromRGB(150, 40, 40)
btn.Text = "Бессмертие: ВЫКЛ"
btn.Font = Enum.Font.GothamMedium
btn.TextSize = 16
btn.TextColor3 = Color3.fromRGB(255, 255, 255)
btn.Parent = frame
Instance.new("UICorner", btn).CornerRadius = UDim.new(0, 8)

btn.MouseButton1Click:Connect(function()
    god = not god
    if god then
        enableGod()
        btn.Text = "Бессмертие: ВКЛ"
        btn.BackgroundColor3 = Color3.fromRGB(40, 150, 70)
    else
        disableGod()
        btn.Text = "Бессмертие: ВЫКЛ"
        btn.BackgroundColor3 = Color3.fromRGB(150, 40, 40)
    end
end)

-- Кнопка 2: безопасная высота
local btn2 = Instance.new("TextButton")
btn2.Size = UDim2.new(1, -30, 0, 44)
btn2.Position = UDim2.new(0, 15, 0, 106)
btn2.BackgroundColor3 = Color3.fromRGB(60, 60, 150)
btn2.Text = "Подняться: ВЫКЛ"
btn2.Font = Enum.Font.GothamMedium
btn2.TextSize = 16
btn2.TextColor3 = Color3.fromRGB(255, 255, 255)
btn2.Parent = frame
Instance.new("UICorner", btn2).CornerRadius = UDim.new(0, 8)

local up = false
btn2.MouseButton1Click:Connect(function()
    up = not up
    if up then goUp() else goDown() end
    btn2.Text = up and "Подняться: ВКЛ" or "Подняться: ВЫКЛ"
end)

-- Кнопка 3: ноуклип
local btn3 = Instance.new("TextButton")
btn3.Size = UDim2.new(1, -30, 0, 44)
btn3.Position = UDim2.new(0, 15, 0, 162)
btn3.BackgroundColor3 = Color3.fromRGB(150, 40, 40)
btn3.Text = "Ноуклип: ВЫКЛ"
btn3.Font = Enum.Font.GothamMedium
btn3.TextSize = 16
btn3.TextColor3 = Color3.fromRGB(255, 255, 255)
btn3.Parent = frame
Instance.new("UICorner", btn3).CornerRadius = UDim.new(0, 8)

local nc = false
btn3.MouseButton1Click:Connect(function()
    nc = not nc
    if nc then
        startNoclip()
        btn3.Text = "Ноуклип: ВКЛ"
        btn3.BackgroundColor3 = Color3.fromRGB(40, 150, 70)
    else
        stopNoclip()
        btn3.Text = "Ноуклип: ВЫКЛ"
        btn3.BackgroundColor3 = Color3.fromRGB(150, 40, 40)
    end
end)

-- Кнопки 4 и 5: ночное зрение и стамина
local function makeToggle(y, name, onFn, offFn)
    local b = Instance.new("TextButton")
    b.Size = UDim2.new(1, -30, 0, 44)
    b.Position = UDim2.new(0, 15, 0, y)
    b.BackgroundColor3 = Color3.fromRGB(150, 40, 40)
    b.Text = name .. ": ВЫКЛ"
    b.Font = Enum.Font.GothamMedium
    b.TextSize = 16
    b.TextColor3 = Color3.fromRGB(255, 255, 255)
    b.Parent = frame
    Instance.new("UICorner", b).CornerRadius = UDim.new(0, 8)
    local state = false
    b.MouseButton1Click:Connect(function()
        state = not state
        if state then
            onFn()
            b.Text = name .. ": ВКЛ"
            b.BackgroundColor3 = Color3.fromRGB(40, 150, 70)
        else
            offFn()
            b.Text = name .. ": ВЫКЛ"
            b.BackgroundColor3 = Color3.fromRGB(150, 40, 40)
        end
    end)
end

makeToggle(218, "Ночное зрение", startNV, stopNV)
makeToggle(274, "Стамина", startStamina, stopStamina)

print("[RM] GUI готов")
