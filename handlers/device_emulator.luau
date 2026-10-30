local simulator = game:GetService("StudioDeviceSimulatorService")
local StarterGui = game:GetService("StarterGui")
local HttpService = game:GetService("HttpService")
local action = params.action

local ORIENTATIONS = {
	portrait = Enum.ScreenOrientation.Portrait,
	landscape = Enum.ScreenOrientation.LandscapeRight,
	landscaperight = Enum.ScreenOrientation.LandscapeRight,
	landscapeleft = Enum.ScreenOrientation.LandscapeLeft,
}

local function orientationOf(name)
	local found = ORIENTATIONS[string.lower(name)]

	if not found then
		error("orientation must be portrait, landscape, landscapeRight or landscapeLeft")
	end

	return found
end

local function guiSize()
	for _, leftover in ipairs(StarterGui:GetChildren()) do
		if leftover.Name == "__DeviceProbe" then
			leftover:Destroy()
		end
	end

	local probe = Instance.new("ScreenGui")
	probe.Name = "__DeviceProbe"
	probe.Archivable = false
	probe.Parent = StarterGui

	task.wait()
	task.wait()

	local size = probe.AbsoluteSize

	probe:Destroy()

	return size
end

local function describeCurrent()
	local device = simulator:GetDeviceAsync()

	if device == "default" then
		local size = guiSize()

		return string.format("no device emulated (normal viewport), GUI space %dx%d", size.X, size.Y)
	end

	local resolution = simulator:GetResolutionAsync()
	local orientation = simulator:GetOrientationAsync()
	local size = guiSize()

	return string.format(
		"%s: %dx%d, %s, GUI space %dx%d",
		device,
		resolution.X,
		resolution.Y,
		orientation.Name,
		size.X,
		size.Y
	)
end

if action == "list" then
	local ids = simulator:GetDeviceListAsync()
	local lines = {}
	local filter = if params.filter then string.lower(params.filter) else nil

	for _, id in ipairs(ids) do
		if not filter or string.find(string.lower(id), filter, 1, true) then
			local detail = ""

			if params.detail then
				local ok, info = pcall(function()
					return simulator:GetDeviceInfoAsync(id)
				end)

				if ok and info then
					detail = string.format(" - %s %dx%d", info.Name, info.Width, info.Height)
				end
			end

			table.insert(lines, id .. detail)
		end
	end

	if #lines == 0 then
		return "no devices match"
	end

	return table.concat(lines, "\n")
elseif action == "get" then
	return describeCurrent()
elseif action == "set" then
	if params.device then
		simulator:SetDeviceAsync(params.device)
	end

	if params.orientation then
		simulator:SetOrientationAsync(orientationOf(params.orientation))
	end

	if params.resolution then
		if type(params.resolution) ~= "table" or type(params.resolution[1]) ~= "number" or type(params.resolution[2]) ~= "number" then
			error("resolution must be [width, height]")
		end

		simulator:SetResolutionAsync(Vector2.new(params.resolution[1], params.resolution[2]))
	end

	if not params.device and not params.orientation and not params.resolution then
		error("give a device, an orientation or a resolution")
	end

	task.wait(0.3)

	return describeCurrent()
elseif action == "stop" then
	simulator:StopSimulationAsync()
	task.wait(0.3)

	return describeCurrent()
elseif action == "info" then
	if type(params.device) ~= "string" then
		error("device is required")
	end

	return HttpService:JSONEncode(simulator:GetDeviceInfoAsync(params.device))
end

error("action must be list, get, set, stop or info")
