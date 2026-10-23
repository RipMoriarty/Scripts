--[[
    District GUI | Violence District
    Автор интро: Rip_Moriarty
    Запуск: вставить в Potassium и нажать Execute
    Скрыть/показать меню: RightShift
]]

-- ================== НАСТРОЙКИ ==================
local CRAWL_THRESHOLD = 8      -- если скорость от игры <= этого значения, считаем что персонаж лежит/ползёт
local RUN_MAX         = 4      -- максимум множителя обычной скорости (x)
local CRAWL_MAX       = 10     -- максимум множителя скорости в лежачем состоянии (x)
local DANCES = {               -- стандартные танцы Roblox (R15)
    {name = "Dance 1", id = "rbxassetid://507771019"},
    {name = "Dance 2", id = "rbxassetid://507776043"},
    {name = "Dance 3", id = "rbxassetid://507777268"},
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
    local old = guiParent:FindFirstChild("DistrictGUI")
    if old then old:Destroy() end
end)

local screen = Instance.new("ScreenGui")
screen.Name = "DistrictGUI"
screen.ResetOnSpawn = false
screen.IgnoreGuiInset = true
screen.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
local ok = pcall(function() screen.Parent = guiParent end)
if not ok then screen.Parent = LP:WaitForChild("PlayerGui") end

-- ================== СОСТОЯНИЕ ==================
local runMult, crawlMult = 1, 1
local noclipOn, danceOn = false, false
local danceIndex = 1
local danceTrack
local gameSpeed, lastTarget = 16, nil
local hookedHum

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
main.Size = UDim2.fromOffset(270, 290)
main.Position = UDim2.new(0.5, -135, 0.5, -145)
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

local function makeSlider(y, label, min, max, callback)
    local holder = Instance.new("Frame")
    holder.Size = UDim2.new(1, -24, 0, 48)
    holder.Position = UDim2.fromOffset(12, y)
    holder.BackgroundColor3 = PANEL
    holder.Parent = main
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

local function makeButton(y, text, callback)
    local b = Instance.new("TextButton")
    b.Size = UDim2.new(1, -24, 0, 36)
    b.Position = UDim2.fromOffset(12, y)
    b.BackgroundColor3 = PANEL
    b.Text = text
    b.Font = Enum.Font.GothamBold
    b.TextSize = 14
    b.TextColor3 = TEXT
    b.AutoButtonColor = true
    b.Parent = main
    Instance.new("UICorner", b).CornerRadius = UDim.new(0, 8)
    b.MouseButton1Click:Connect(function() callback(b) end)
    return b
end

local function setState(btn, name, on)
    btn.Text = name .. ": " .. (on and "ВКЛ" or "ВЫКЛ")
    btn.BackgroundColor3 = on and ACCENT or PANEL
end

makeSlider(42,  "Скорость",           1, RUN_MAX,   function(v) runMult = v end)
makeSlider(96,  "Скорость лёжа",      1, CRAWL_MAX, function(v) crawlMult = v end)

local danceBtn = makeButton(152, "", function(btn)
    danceOn = not danceOn
    setState(btn, "Танец", danceOn)
    if not danceOn and danceTrack then
        danceTrack:Stop()
        danceTrack = nil
    end
end)
setState(danceBtn, "Танец", false)

makeButton(194, "Сменить танец: " .. DANCES[1].name, function(btn)
    danceIndex = danceIndex % #DANCES + 1
    btn.Text = "Сменить танец: " .. DANCES[danceIndex].name
    if danceTrack then danceTrack:Stop(); danceTrack = nil end
end)

local noclipBtn = makeButton(236, "", function(btn)
    noclipOn = not noclipOn
    setState(btn, "Noclip", noclipOn)
end)
setState(noclipBtn, "Noclip", false)

closeBtn.MouseButton1Click:Connect(function() main.Visible = false end)
UserInputService.InputBegan:Connect(function(i, gp)
    if not gp and i.KeyCode == Enum.KeyCode.RightShift then
        main.Visible = not main.Visible
    end
end)

-- ================== ЛОГИКА ==================

-- Запоминаем скорость, которую выставляет сама игра (чтобы отличать бег от ползания)
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
    local mult = (gameSpeed <= CRAWL_THRESHOLD) and crawlMult or runMult
    if mult ~= 1 then
        local target = gameSpeed * mult
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
                anim.AnimationId = DANCES[danceIndex].id
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
