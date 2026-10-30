local action = params.action
local EFFECT_CLASSES = {"ParticleEmitter", "Beam", "Trail", "Fire", "Smoke", "Sparkles", "PointLight", "SpotLight", "SurfaceLight"}
local TOGGLED = {"ParticleEmitter", "Beam", "Trail", "Fire", "Smoke", "Sparkles", "PointLight", "SpotLight", "SurfaceLight"}

local function isEffect(instance)
	for _, className in ipairs(EFFECT_CLASSES) do
		if instance:IsA(className) then
			return true
		end
	end

	return false
end

local function selected()
	local found = {}
	local seen = {}

	local function add(instance)
		if not seen[instance] and isEffect(instance) and (not params.class or instance:IsA(params.class)) and (not params.nameContains or string.find(string.lower(instance.Name), string.lower(params.nameContains), 1, true)) then
			seen[instance] = true
			table.insert(found, instance)
		end
	end

	if params.paths then
		for _, path in ipairs(params.paths) do
			local target = resolve(path)

			add(target)

			for _, descendant in ipairs(target:GetDescendants()) do
				add(descendant)
			end
		end
	else
		local root = if params.root then resolve(params.root) else workspace

		for _, descendant in ipairs(root:GetDescendants()) do
			add(descendant)
		end
	end

	return found
end

local function typeCounts(list)
	local counts = {}

	for _, instance in ipairs(list) do
		counts[instance.ClassName] = (counts[instance.ClassName] or 0) + 1
	end

	local parts = {}

	for name, amount in pairs(counts) do
		table.insert(parts, name .. " " .. amount)
	end

	table.sort(parts)

	return table.concat(parts, ", ")
end

if action == "list" then
	local found = selected()

	if #found == 0 then
		return "no effects found"
	end

	local lines = {#found .. " effects: " .. typeCounts(found)}
	local limit = params.limit or 40

	for index = 1, math.min(#found, limit) do
		local instance = found[index]
		local state = ""

		if instance:IsA("ParticleEmitter") or instance:IsA("Beam") or instance:IsA("Trail") or instance:IsA("Fire") or instance:IsA("Smoke") or instance:IsA("Sparkles") or instance:IsA("Light") then
			state = if instance.Enabled then " on" else " off"
		end

		table.insert(lines, pathOf(instance) .. " [" .. instance.ClassName .. "]" .. state)
	end

	if #found > limit then
		table.insert(lines, (#found - limit) .. " more not shown")
	end

	return table.concat(lines, "\n")
elseif action == "set_enabled" then
	if type(params.enabled) ~= "boolean" then
		error("enabled must be true or false")
	end

	local changed = 0

	for _, instance in ipairs(selected()) do
		for _, className in ipairs(TOGGLED) do
			if instance:IsA(className) then
				instance.Enabled = params.enabled
				changed += 1

				break
			end
		end
	end

	return (if params.enabled then "enabled " else "disabled ") .. changed .. " effect(s)"
elseif action == "emit" then
	local count = params.count or 20
	local emitted = 0

	for _, instance in ipairs(selected()) do
		if instance:IsA("ParticleEmitter") then
			instance:Emit(count)
			emitted += 1
		end
	end

	if emitted == 0 then
		error("no ParticleEmitters matched")
	end

	return "emitted " .. count .. " particle(s) from " .. emitted .. " emitter(s)"
elseif action == "clear" then
	local cleared = 0

	for _, instance in ipairs(selected()) do
		if instance:IsA("ParticleEmitter") then
			instance:Clear()
			cleared += 1
		end
	end

	return "cleared " .. cleared .. " emitter(s)"
end

error("action must be list, set_enabled, emit or clear")
