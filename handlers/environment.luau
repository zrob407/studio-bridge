local Lighting = game:GetService("Lighting")
local action = params.action or "get"

local SECTIONS = {
	atmosphere = "Atmosphere",
	bloom = "BloomEffect",
	colorCorrection = "ColorCorrectionEffect",
	sunRays = "SunRaysEffect",
	depthOfField = "DepthOfFieldEffect",
	sky = "Sky",
}

local READ = {
	lighting = {"ClockTime", "Brightness", "Ambient", "OutdoorAmbient", "ColorShift_Top", "ColorShift_Bottom", "ExposureCompensation", "EnvironmentDiffuseScale", "EnvironmentSpecularScale", "GlobalShadows", "ShadowSoftness"},
	atmosphere = {"Density", "Offset", "Color", "Decay", "Glare", "Haze"},
	bloom = {"Intensity", "Size", "Threshold"},
	colorCorrection = {"Brightness", "Contrast", "Saturation", "TintColor"},
	sunRays = {"Intensity", "Spread"},
	depthOfField = {"FarIntensity", "FocusDistance", "InFocusRadius", "NearIntensity"},
	sky = {"CelestialBodiesShown", "StarCount", "SunAngularSize", "MoonAngularSize", "SkyboxBk", "SkyboxDn", "SkyboxFt", "SkyboxLf", "SkyboxRt", "SkyboxUp"},
	terrain = {"WaterColor", "WaterReflectance", "WaterTransparency", "WaterWaveSize", "WaterWaveSpeed", "Decoration"},
}

local ORDER = {"lighting", "atmosphere", "bloom", "colorCorrection", "sunRays", "depthOfField", "sky", "terrain"}

local function rgb(r, g, b)
	return Color3.fromRGB(r, g, b)
end

local PRESETS = {
	day = {
		description = "Bright midday with light haze",
		lighting = {ClockTime = 14, Brightness = 3, Ambient = rgb(70, 70, 70), OutdoorAmbient = rgb(120, 130, 140), ColorShift_Top = rgb(0, 0, 0), ExposureCompensation = 0},
		atmosphere = {Density = 0.3, Offset = 0.25, Color = rgb(199, 210, 225), Decay = rgb(106, 112, 125), Glare = 0, Haze = 1},
		bloom = {Intensity = 0.3, Size = 24, Threshold = 2},
		colorCorrection = {Brightness = 0, Contrast = 0.05, Saturation = 0.05, TintColor = rgb(255, 255, 255)},
		sunRays = {Intensity = 0.15, Spread = 0.7},
	},
	sunset = {
		description = "Low orange sun, warm haze",
		lighting = {ClockTime = 18.2, Brightness = 2, Ambient = rgb(80, 60, 60), OutdoorAmbient = rgb(150, 100, 90), ColorShift_Top = rgb(255, 160, 90), ExposureCompensation = 0.1},
		atmosphere = {Density = 0.35, Offset = 0.2, Color = rgb(255, 180, 140), Decay = rgb(120, 80, 90), Glare = 0.4, Haze = 1.5},
		bloom = {Intensity = 0.6, Size = 30, Threshold = 1.6},
		colorCorrection = {Brightness = 0, Contrast = 0.1, Saturation = 0.15, TintColor = rgb(255, 235, 220)},
		sunRays = {Intensity = 0.3, Spread = 0.8},
	},
	night = {
		description = "Moonlit night, cool blue",
		lighting = {ClockTime = 0, Brightness = 0.5, Ambient = rgb(20, 25, 45), OutdoorAmbient = rgb(35, 45, 80), ColorShift_Top = rgb(0, 0, 0), ExposureCompensation = 0.2},
		atmosphere = {Density = 0.35, Offset = 0, Color = rgb(80, 95, 140), Decay = rgb(20, 25, 50), Glare = 0, Haze = 0.5},
		bloom = {Intensity = 0.4, Size = 24, Threshold = 1.5},
		colorCorrection = {Brightness = 0, Contrast = 0.1, Saturation = -0.05, TintColor = rgb(200, 215, 255)},
		sunRays = {Intensity = 0, Spread = 0.5},
	},
	overcast = {
		description = "Grey flat daylight",
		lighting = {ClockTime = 13, Brightness = 1.5, Ambient = rgb(90, 92, 95), OutdoorAmbient = rgb(110, 115, 120), ColorShift_Top = rgb(0, 0, 0), ExposureCompensation = 0},
		atmosphere = {Density = 0.55, Offset = 0, Color = rgb(190, 195, 200), Decay = rgb(140, 145, 150), Glare = 0, Haze = 3},
		bloom = {Intensity = 0.1, Size = 24, Threshold = 2},
		colorCorrection = {Brightness = 0, Contrast = 0, Saturation = -0.2, TintColor = rgb(255, 255, 255)},
		sunRays = {Intensity = 0, Spread = 0.5},
	},
	foggy = {
		description = "Early morning, thick fog",
		lighting = {ClockTime = 7, Brightness = 1.2, Ambient = rgb(100, 105, 110), OutdoorAmbient = rgb(120, 125, 130), ColorShift_Top = rgb(0, 0, 0), ExposureCompensation = 0},
		atmosphere = {Density = 0.7, Offset = 0.1, Color = rgb(200, 205, 210), Decay = rgb(160, 165, 170), Glare = 0, Haze = 5},
		bloom = {Intensity = 0.2, Size = 24, Threshold = 2},
		colorCorrection = {Brightness = 0, Contrast = -0.05, Saturation = -0.1, TintColor = rgb(245, 248, 255)},
		sunRays = {Intensity = 0.05, Spread = 0.9},
	},
	horror = {
		description = "Dark, desaturated, green-grey",
		lighting = {ClockTime = 23.5, Brightness = 0.2, Ambient = rgb(10, 10, 14), OutdoorAmbient = rgb(20, 22, 30), ColorShift_Top = rgb(0, 0, 0), ExposureCompensation = -0.2},
		atmosphere = {Density = 0.45, Offset = 0, Color = rgb(40, 45, 55), Decay = rgb(10, 12, 18), Glare = 0, Haze = 2},
		bloom = {Intensity = 0.3, Size = 20, Threshold = 1.8},
		colorCorrection = {Brightness = -0.05, Contrast = 0.25, Saturation = -0.35, TintColor = rgb(190, 210, 200)},
		sunRays = {Intensity = 0, Spread = 0.5},
	},
	space = {
		description = "No atmosphere, black ambient, strong bloom",
		lighting = {ClockTime = 0, Brightness = 0, Ambient = rgb(30, 30, 45), OutdoorAmbient = rgb(10, 10, 20), ColorShift_Top = rgb(0, 0, 0), ExposureCompensation = 0},
		atmosphere = {Density = 0, Offset = 0, Color = rgb(0, 0, 0), Decay = rgb(0, 0, 0), Glare = 0, Haze = 0},
		bloom = {Intensity = 0.6, Size = 30, Threshold = 1.2},
		colorCorrection = {Brightness = 0, Contrast = 0.15, Saturation = 0.1, TintColor = rgb(255, 255, 255)},
		sunRays = {Intensity = 0, Spread = 0.5},
	},
}

local function sectionInstance(key, create)
	if key == "lighting" then
		return Lighting
	end

	if key == "terrain" then
		return workspace.Terrain
	end

	local class = SECTIONS[key]

	if not class then
		error("unknown section: " .. key)
	end

	local existing = Lighting:FindFirstChildOfClass(class)

	if existing or not create then
		return existing
	end

	local made = Instance.new(class)
	made.Name = class
	made.Parent = Lighting

	return made
end

local function applySection(key, values, problems)
	local instance = sectionInstance(key, true)

	for name, value in pairs(values) do
		local ok, problem = pcall(function()
			instance[name] = decode(value)
		end)

		if not ok then
			table.insert(problems, key .. "." .. name .. ": " .. tostring(problem))
		end
	end
end

if action == "list" then
	local names = {}

	for name in pairs(PRESETS) do
		table.insert(names, name)
	end

	table.sort(names)

	local lines = {}

	for _, name in ipairs(names) do
		table.insert(lines, name .. ": " .. PRESETS[name].description)
	end

	return table.concat(lines, "\n")
elseif action == "get" then
	local lines = {}

	for _, key in ipairs(ORDER) do
		local instance = sectionInstance(key, false)

		if instance then
			local parts = {}

			for _, name in ipairs(READ[key]) do
				local ok, value = pcall(function()
					return instance[name]
				end)

				if ok then
					table.insert(parts, name .. "=" .. HttpService:JSONEncode(encode(value)))
				end
			end

			table.insert(lines, key .. ": " .. table.concat(parts, " "))
		end
	end

	return table.concat(lines, "\n")
elseif action == "apply" then
	local problems = {}
	local applied = {}
	local hours = params.time

	if type(hours) == "string" and tonumber(hours) then
		hours = tonumber(hours)
	elseif type(hours) == "string" then
		local h, m = string.match(hours, "^%s*(%d+):(%d+)%s*$")

		if not h then
			error("time must be a number of hours or HH:MM")
		end

		hours = tonumber(h) + tonumber(m) / 60
	end

	if params.preset and not PRESETS[params.preset] then
		error("unknown preset: " .. params.preset .. " (use action list)")
	end

	if params.preset then
		local preset = PRESETS[params.preset]

		if not preset then
			error("unknown preset: " .. params.preset .. " (use action list)")
		end

		for _, key in ipairs(ORDER) do
			if preset[key] then
				applySection(key, preset[key], problems)
			end
		end

		table.insert(applied, "preset " .. params.preset)
	end

	for _, key in ipairs(ORDER) do
		if params[key] then
			applySection(key, params[key], problems)
			table.insert(applied, key)
		end
	end

	if hours ~= nil then
		Lighting.ClockTime = hours
		table.insert(applied, "time " .. string.format("%.2f", Lighting.ClockTime))
	end

	if #applied == 0 then
		error("give a preset, a time or at least one section to change")
	end

	local message = "applied " .. table.concat(applied, ", ")

	if #problems > 0 then
		message ..= "\nproblems:\n" .. table.concat(problems, "\n")
	end

	return message
end

error("action must be list, get or apply")
