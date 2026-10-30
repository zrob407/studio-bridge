local root = resolve(params.path)
local StarterGui = game:GetService("StarterGui")
local minTouch = params.minTouch or 44
local minText = params.minText or 10
local emulator = params.emulator == true
local simulator = if emulator then game:GetService("StudioDeviceSimulatorService") else nil
local TOPBAR = 36
local EXAMPLES = 4

local PRESETS = {
	["phone-small"] = {360, 640, true},
	phone = {390, 844, true},
	["phone-landscape"] = {844, 390, true},
	tablet = {820, 1180, true},
	["tablet-landscape"] = {1180, 820, true},
	laptop = {1366, 768, false},
	desktop = {1920, 1080, false},
}

local TOUCH_FRAGMENTS = {"iphone", "ipad", "samsung", "xiaomi", "amazon_fire", "handheld"}

if not root:IsA("GuiBase2d") then
	error(pathOf(root) .. " is not a GUI object or container")
end

local function touchByName(id)
	local lowered = string.lower(id)

	for _, fragment in ipairs(TOUCH_FRAGMENTS) do
		if string.find(lowered, fragment, 1, true) then
			return true
		end
	end

	return false
end

local devices = {}

if emulator then
	if type(params.devices) ~= "table" or #params.devices == 0 then
		error("emulator mode needs devices: a list of device ids (see device_emulator list)")
	end

	for _, entry in ipairs(params.devices) do
		if type(entry) == "string" then
			table.insert(devices, {name = entry, deviceId = entry, touch = touchByName(entry)})
		else
			table.insert(devices, {
				name = entry.id,
				deviceId = entry.id,
				orientation = entry.orientation,
				touch = if entry.touch ~= nil then entry.touch else touchByName(entry.id),
			})
		end
	end
else
	for _, entry in ipairs(params.devices or {"phone", "tablet", "desktop"}) do
		if type(entry) == "string" then
			local preset = PRESETS[entry]

			if not preset then
				error("unknown device " .. entry .. "; use phone-small, phone, phone-landscape, tablet, tablet-landscape, laptop or desktop")
			end

			table.insert(devices, {name = entry, width = preset[1], height = preset[2], touch = preset[3]})
		else
			table.insert(devices, {name = entry.name or (entry.width .. "x" .. entry.height), width = entry.width, height = entry.height, touch = entry.touch == true})
		end
	end
end

if emulator and #devices > 10 then
	error("emulator mode checks at most 10 devices per call so it finishes before the command timeout; split the list")
end

local gui = if root:IsA("ScreenGui") then root else root:FindFirstAncestorOfClass("ScreenGui")
local inset = if gui and not gui.IgnoreGuiInset then TOPBAR else 0
local sources = {}

if root:IsA("ScreenGui") then
	for _, child in ipairs(root:GetChildren()) do
		if child:IsA("GuiObject") then
			table.insert(sources, child)
		end
	end
else
	sources = {root}
end

if #sources == 0 then
	error(pathOf(root) .. " has nothing to check")
end

for _, leftover in ipairs(StarterGui:GetChildren()) do
	if leftover.Name == "__ResponsiveProbe" then
		leftover:Destroy()
	end
end

local originalDevice = if emulator then simulator:GetDeviceAsync() else nil
local originalOrientation = if emulator and originalDevice ~= "default" then simulator:GetOrientationAsync() else nil

local probe = Instance.new("ScreenGui")
probe.Name = "__ResponsiveProbe"
probe.Archivable = false
probe.IgnoreGuiInset = true
probe.ResetOnSpawn = false
probe.Parent = StarterGui

local frame = Instance.new("Frame")
frame.BackgroundTransparency = 1
frame.BorderSizePixel = 0
frame.Parent = probe

local ORIENTATIONS = {
	portrait = Enum.ScreenOrientation.Portrait,
	landscape = Enum.ScreenOrientation.LandscapeRight,
	landscaperight = Enum.ScreenOrientation.LandscapeRight,
	landscapeleft = Enum.ScreenOrientation.LandscapeLeft,
}

local function relativeName(item)
	local names = {}
	local current = item

	while current and current ~= frame do
		table.insert(names, 1, current.Name)
		current = current.Parent
	end

	return table.concat(names, ".")
end

local function visibleWithinFrame(item)
	local current = item

	while current and current ~= frame do
		if current:IsA("GuiObject") and not current.Visible then
			return false
		end

		current = current.Parent
	end

	return true
end

local function insideScrolling(item)
	local current = item.Parent

	while current and current ~= frame do
		if current:IsA("ScrollingFrame") then
			return true
		end

		current = current.Parent
	end

	return false
end

local function hasText(item)
	return (item:IsA("TextLabel") or item:IsA("TextButton") or item:IsA("TextBox")) and item.Text ~= ""
end

local function checkDevice(device)
	if emulator then
		simulator:SetDeviceAsync(device.deviceId)

		if device.orientation then
			local orientation = ORIENTATIONS[string.lower(device.orientation)]

			if not orientation then
				error("orientation must be portrait, landscape, landscapeRight or landscapeLeft")
			end

			simulator:SetOrientationAsync(orientation)
		end

		task.wait(0.5)

		device.width = math.floor(probe.AbsoluteSize.X + 0.5)
		device.height = math.floor(probe.AbsoluteSize.Y + 0.5)
	end

	for _, child in ipairs(frame:GetChildren()) do
		child:Destroy()
	end

	local height = device.height - inset

	frame.Position = UDim2.fromOffset(0, inset)
	frame.Size = UDim2.fromOffset(device.width, height)

	for _, source in ipairs(sources) do
		source:Clone().Parent = frame
	end

	task.wait()
	task.wait()

	local found = {outside = {}, touch = {}, text = {}, overflow = {}, collapsed = {}}
	local origin = frame.AbsolutePosition
	local total = 0

	for _, item in ipairs(frame:GetDescendants()) do
		if item:IsA("GuiObject") and visibleWithinFrame(item) then
			total += 1

			local size = item.AbsoluteSize
			local position = item.AbsolutePosition - origin

			if not insideScrolling(item) and (position.X < -2 or position.Y < -2 or position.X + size.X > device.width + 2 or position.Y + size.Y > height + 2) then
				table.insert(found.outside, relativeName(item))
			end

			if device.touch and (item:IsA("GuiButton") or item:IsA("TextBox")) and math.min(size.X, size.Y) < minTouch then
				table.insert(found.touch, string.format("%s (%dx%d)", relativeName(item), size.X, size.Y))
			end

			if hasText(item) then
				local effective = if item.TextScaled then item.TextBounds.Y else item.TextSize

				if effective < minText then
					table.insert(found.text, string.format("%s (%d)", relativeName(item), effective))
				end

				if not item.TextScaled and not item.TextWrapped and item.TextTruncate == Enum.TextTruncate.None and item.TextBounds.X > size.X + 1 then
					table.insert(found.overflow, relativeName(item))
				end
			end

			if (size.X < 1 or size.Y < 1) and (item:IsA("GuiButton") or item:IsA("ImageLabel") or hasText(item)) then
				table.insert(found.collapsed, relativeName(item))
			end
		end
	end

	return found, total
end

local LABELS = {
	{"outside", "extend past the screen"},
	{"touch", "are smaller than " .. minTouch .. "px to tap"},
	{"text", "have text smaller than " .. minText .. "px"},
	{"overflow", "have text wider than their box"},
	{"collapsed", "have no size"},
}

local lines = {}
local ran, problem = pcall(function()
	for _, device in ipairs(devices) do
		local found, total = checkDevice(device)
		local issues = 0

		for _, entry in ipairs(LABELS) do
			issues += #found[entry[1]]
		end

		table.insert(lines, string.format("%s %dx%d: %s (%d elements)", device.name, device.width, device.height, if issues == 0 then "ok" else issues .. " issue(s)", total))

		for _, entry in ipairs(LABELS) do
			local list = found[entry[1]]

			if #list > 0 then
				local shown = {}

				for index = 1, math.min(#list, EXAMPLES) do
					table.insert(shown, list[index])
				end

				table.insert(lines, string.format("  %d %s: %s%s", #list, entry[2], table.concat(shown, ", "), if #list > EXAMPLES then ", ..." else ""))
			end
		end
	end
end)

probe:Destroy()

if emulator then
	pcall(function()
		if originalDevice == "default" then
			simulator:StopSimulationAsync()
		else
			simulator:SetDeviceAsync(originalDevice)
			simulator:SetOrientationAsync(originalOrientation)
		end
	end)
end

if not ran then
	error(tostring(problem))
end

return table.concat(lines, "\n")
