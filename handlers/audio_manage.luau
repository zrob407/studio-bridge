local action = params.action
local root = if params.root then resolve(params.root) else game
local EFFECTS = {"ChorusSoundEffect", "CompressorSoundEffect", "DistortionSoundEffect", "EchoSoundEffect", "EqualizerSoundEffect", "FlangeSoundEffect", "PitchShiftSoundEffect", "ReverbSoundEffect", "TremoloSoundEffect"}

local function numberOf(value)
	local digits = string.match(tostring(value), "%d+")

	if not digits then
		error("not an asset id: " .. tostring(value))
	end

	return digits
end

local function applyProperties(instance, properties, problems)
	for name, value in pairs(properties or {}) do
		local ok, problem = pcall(function()
			instance[name] = decode(value)
		end)

		if not ok then
			table.insert(problems, pathOf(instance) .. "." .. name .. ": " .. tostring(problem))
		end
	end
end

local function targetSounds()
	local found = {}

	if params.paths then
		for _, path in ipairs(params.paths) do
			local instance = resolve(path)

			if not instance:IsA("Sound") then
				error(pathOf(instance) .. " is not a Sound")
			end

			table.insert(found, instance)
		end

		return found
	end

	for _, descendant in ipairs(root:GetDescendants()) do
		if descendant:IsA("Sound") and (not params.nameContains or string.find(string.lower(descendant.Name), string.lower(params.nameContains), 1, true)) then
			table.insert(found, descendant)
		end
	end

	return found
end

local function report(message, problems)
	if #problems > 0 then
		message ..= "\nproblems:\n" .. table.concat(problems, "\n")
	end

	return message
end

if action == "list" then
	local sounds = targetSounds()

	if #sounds == 0 then
		return "no sounds found"
	end

	local limit = params.limit or 100
	local lines = {}

	for index = 1, math.min(#sounds, limit) do
		local sound = sounds[index]

		table.insert(lines, string.format(
			"%s id %s vol %.2f speed %.2f%s rolloff %s %g-%g%s",
			pathOf(sound),
			if sound.SoundId == "" then "(none)" else (string.match(sound.SoundId, "%d+") or sound.SoundId),
			sound.Volume,
			sound.PlaybackSpeed,
			if sound.Looped then " looped" else "",
			sound.RollOffMode.Name,
			sound.RollOffMinDistance,
			sound.RollOffMaxDistance,
			if sound.SoundGroup then " group " .. sound.SoundGroup.Name else ""
		))
	end

	if #sounds > limit then
		table.insert(lines, (#sounds - limit) .. " more not shown")
	end

	return table.concat(lines, "\n")
elseif action == "create" then
	local parent = resolve(params.parent)
	local sound = Instance.new("Sound")
	local problems = {}

	sound.Name = params.name or "Sound"

	if params.soundId then
		sound.SoundId = "rbxassetid://" .. numberOf(params.soundId)
	end

	if params.soundGroup then
		sound.SoundGroup = resolve(params.soundGroup)
	end

	sound.Parent = parent
	applyProperties(sound, params.properties, problems)

	return report("created " .. pathOf(sound), problems)
elseif action == "set" then
	local sounds = targetSounds()
	local problems = {}
	local scale = params.volumeScale

	if #sounds == 0 then
		error("no sounds matched")
	end

	for _, sound in ipairs(sounds) do
		applyProperties(sound, params.properties, problems)

		if scale then
			sound.Volume = math.clamp(sound.Volume * scale, 0, 10)
		end

		if params.soundGroup then
			sound.SoundGroup = resolve(params.soundGroup)
		end
	end

	return report("updated " .. #sounds .. " sound(s)", problems)
elseif action == "group" then
	local parent = if params.parent then resolve(params.parent) else game:GetService("SoundService")
	local group = Instance.new("SoundGroup")
	local problems = {}

	group.Name = params.name or "SoundGroup"
	group.Parent = parent
	applyProperties(group, params.properties, problems)

	local assigned = 0

	if params.paths or params.nameContains then
		for _, sound in ipairs(targetSounds()) do
			sound.SoundGroup = group
			assigned += 1
		end
	end

	return report("created " .. pathOf(group) .. " and assigned " .. assigned .. " sound(s)", problems)
elseif action == "effect" then
	local effectClass = params.effect

	if not table.find(EFFECTS, effectClass) then
		error("effect must be one of " .. table.concat(EFFECTS, ", "))
	end

	local host = resolve(params.path)

	if not host:IsA("Sound") and not host:IsA("SoundGroup") then
		error(pathOf(host) .. " is not a Sound or SoundGroup")
	end

	local effect = Instance.new(effectClass)
	local problems = {}

	effect.Parent = host
	applyProperties(effect, params.properties, problems)

	return report("added " .. effectClass .. " to " .. pathOf(host), problems)
elseif action == "remap" then
	if type(params.map) ~= "table" or next(params.map) == nil then
		error("map is required, for example {\"123\": \"456\"}")
	end

	local replacements = {}

	for old, new in pairs(params.map) do
		replacements[numberOf(old)] = numberOf(new)
	end

	local changed = 0

	for _, sound in ipairs(targetSounds()) do
		local current = string.match(sound.SoundId, "%d+")
		local replacement = current and replacements[current]

		if replacement then
			changed += 1

			if not params.dryRun then
				sound.SoundId = "rbxassetid://" .. replacement
			end
		end
	end

	return (if params.dryRun then "would change " else "changed ") .. changed .. " sound(s)"
elseif action == "play" or action == "pause" or action == "resume" or action == "stop" then
	local sounds = targetSounds()

	if #sounds == 0 then
		error("no sounds matched")
	end

	for _, sound in ipairs(sounds) do
		if action == "play" then
			sound:Play()
		elseif action == "pause" then
			sound:Pause()
		elseif action == "resume" then
			sound:Resume()
		else
			sound:Stop()
		end
	end

	if action == "play" and params.seconds then
		task.delay(params.seconds, function()
			for _, sound in ipairs(sounds) do
				if sound.Parent then
					sound:Stop()
				end
			end
		end)
	end

	return action .. " on " .. #sounds .. " sound(s)" .. (if action == "play" and params.seconds then ", stopping after " .. params.seconds .. "s" else "")
end

error("action must be list, create, set, group, effect, remap, play, pause, resume or stop")
