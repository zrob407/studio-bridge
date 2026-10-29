local HttpService = game:GetService("HttpService")
local CollectionService = game:GetService("CollectionService")
local function optionalService(name)
	local ok, service = pcall(game.GetService, game, name)

	return if ok then service else nil
end

local ScriptEditorService = optionalService("ScriptEditorService")
local ReflectionService = optionalService("ReflectionService")

local function bridgeState()
	local state = shared.__ClaudeBridge

	if not state then
		state = {lastPlayEnded = 0}
		shared.__ClaudeBridge = state
	end

	return state
end

local function toVector3(value, label)
	if type(value) ~= "table" or type(value[1]) ~= "number" or type(value[2]) ~= "number" or type(value[3]) ~= "number" then
		error(label .. " must be an array of three numbers")
	end

	return Vector3.new(value[1], value[2], value[3])
end

local function pathOf(instance)
	if instance == game then
		return "game"
	end

	local parts = {}
	local current = instance

	while current and current ~= game do
		local name = current.Name

		if string.match(name, "^[%a_][%w_]*$") then
			table.insert(parts, 1, "." .. name)
		else
			table.insert(parts, 1, '["' .. name .. '"]')
		end

		current = current.Parent
	end

	return "game" .. table.concat(parts)
end

local function splitPath(path)
	local segments = {}
	local index = 1

	while index <= #path do
		local char = string.sub(path, index, index)

		if char == "." then
			index += 1
		elseif char == "[" then
			local quote = string.sub(path, index + 1, index + 1)
			local close = string.find(path, quote .. "]", index + 2, true)

			if not close then
				error("unterminated [ in path: " .. path)
			end

			table.insert(segments, string.sub(path, index + 2, close - 1))
			index = close + 2
		else
			local stop = string.find(path, "[%.%[]", index) or (#path + 1)

			table.insert(segments, string.sub(path, index, stop - 1))
			index = stop
		end
	end

	return segments
end

local function resolve(path)
	if type(path) ~= "string" or path == "" then
		error("path is required")
	end

	local segments = splitPath(path)
	local current = game
	local first = if segments[1] == "game" then 2 else 1

	for index = first, #segments do
		local name = segments[index]
		local child = current:FindFirstChild(name)

		if not child and current == game then
			local ok, service = pcall(game.GetService, game, name)

			if ok then
				child = service
			end
		end

		if not child then
			error("not found: " .. name .. " (under " .. pathOf(current) .. ")")
		end

		current = child
	end

	return current
end

local function encode(value)
	local kind = typeof(value)

	if kind == "string" or kind == "boolean" then
		return value
	elseif kind == "number" then
		if value ~= value then
			return {Number = "nan"}
		elseif value == math.huge then
			return {Number = "inf"}
		elseif value == -math.huge then
			return {Number = "-inf"}
		end

		return value
	elseif kind == "Vector3" then
		return {Vector3 = {value.X, value.Y, value.Z}}
	elseif kind == "Vector2" then
		return {Vector2 = {value.X, value.Y}}
	elseif kind == "Color3" then
		return {Color3 = {math.round(value.R * 255), math.round(value.G * 255), math.round(value.B * 255)}}
	elseif kind == "CFrame" then
		return {CFrame = {value:GetComponents()}}
	elseif kind == "UDim2" then
		return {UDim2 = {value.X.Scale, value.X.Offset, value.Y.Scale, value.Y.Offset}}
	elseif kind == "UDim" then
		return {UDim = {value.Scale, value.Offset}}
	elseif kind == "EnumItem" then
		return {Enum = tostring(value)}
	elseif kind == "BrickColor" then
		return {BrickColor = value.Name}
	elseif kind == "NumberRange" then
		return {NumberRange = {value.Min, value.Max}}
	elseif kind == "Instance" then
		return {Instance = pathOf(value)}
	end

	return {Unsupported = kind .. ": " .. tostring(value)}
end

local function decode(value)
	if type(value) ~= "table" then
		return value
	end

	if value.Vector3 then
		local v = value.Vector3
		return Vector3.new(v[1], v[2], v[3])
	elseif value.Vector2 then
		local v = value.Vector2
		return Vector2.new(v[1], v[2])
	elseif value.Color3 then
		local v = value.Color3
		return Color3.fromRGB(v[1], v[2], v[3])
	elseif value.CFrame then
		return CFrame.new(table.unpack(value.CFrame))
	elseif value.UDim2 then
		local v = value.UDim2
		return UDim2.new(v[1], v[2], v[3], v[4])
	elseif value.UDim then
		local v = value.UDim
		return UDim.new(v[1], v[2])
	elseif value.Enum then
		local parts = string.split(value.Enum, ".")
		return Enum[parts[2]][parts[3]]
	elseif value.BrickColor then
		return BrickColor.new(value.BrickColor)
	elseif value.NumberRange then
		local v = value.NumberRange
		return NumberRange.new(v[1], v[2])
	elseif value.Instance then
		return resolve(value.Instance)
	elseif value.Number then
		if value.Number == "inf" then
			return math.huge
		elseif value.Number == "-inf" then
			return -math.huge
		end

		return 0 / 0
	end

	error("unknown value form: " .. HttpService:JSONEncode(value))
end

local function readSource(script)
	local ok, text = pcall(function()
		return ScriptEditorService:GetEditorSource(script)
	end)

	return if ok then text else script.Source
end

local function writeSource(script, text)
	local ok = pcall(function()
		ScriptEditorService:UpdateSourceAsync(script, function()
			return text
		end)
	end)

	if not ok then
		script.Source = text
	end
end

local function requireScript(path)
	local script = resolve(path)

	if not script:IsA("LuaSourceContainer") then
		error(pathOf(script) .. " is a " .. script.ClassName .. ", not a script")
	end

	return script
end

local function syntaxError(source)
	local fn, message = loadstring(source, "=validate")

	if fn then
		return nil
	end

	return tostring(message)
end
