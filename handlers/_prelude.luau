-- Shared helpers. The bridge puts this file in front of every tool handler before it is sent to Studio,
-- so every function here is available to handlers/<name>.luau without a require.
-- Keep it small: it is sent with every call. Put helpers used by only a few tools in their own _name.luau file
-- and list them in HANDLER_INCLUDES in server.mjs.

local HttpService = game:GetService("HttpService")
local CollectionService = game:GetService("CollectionService")
-- Returns a service, or nil when this Studio build does not have it.
local function optionalService(name)
	local ok, service = pcall(game.GetService, game, name)

	return if ok then service else nil
end

local ScriptEditorService = optionalService("ScriptEditorService")
local ReflectionService = optionalService("ReflectionService")

-- State that survives between calls (the table lives in shared). Use it for things a later call needs to see, such as when a play session last ended.
local function bridgeState()
	local state = shared.__StudioBridge

	if not state then
		state = {lastPlayEnded = 0}
		shared.__StudioBridge = state
	end

	return state
end

-- Reads {x, y, z} from tool arguments into a Vector3. The label names the argument in the error message.
local function toVector3(value, label)
	if type(value) ~= "table" or type(value[1]) ~= "number" or type(value[2]) ~= "number" or type(value[3]) ~= "number" then
		error(label .. " must be an array of three numbers")
	end

	return Vector3.new(value[1], value[2], value[3])
end

-- The reverse of resolve: an Instance as a path like game.Workspace.Model["Part 1"]. Names that are not plain identifiers use brackets.
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

-- Splits a path string into names, handling both .Name and ["Name"] segments.
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

-- Finds an Instance from a path string such as game.Workspace.Model, with or without the leading "game". Services are found even when they are not children yet. Throws "not found" with the parent that was searched.
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

-- Turns a Roblox value into something JSON can carry: Vector3 becomes {Vector3 = {x, y, z}}, an Instance becomes its path, and so on. Add a branch here when a tool needs to return a new type, and a matching one in decode.
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

-- The reverse of encode: turns the JSON forms back into Roblox values, so tool arguments such as {Color3 = {255, 0, 0}} or {Instance = "game.Workspace.Part"} can set properties.
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

-- Reads a script's source, preferring the open editor's copy so unsaved edits are seen.
local function readSource(script)
	local ok, text = pcall(function()
		return ScriptEditorService:GetEditorSource(script)
	end)

	return if ok then text else script.Source
end

-- Writes a script's source through the script editor, which keeps the open tab in sync, and falls back to setting Source directly.
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

-- resolve, but throws unless the result is a script.
local function requireScript(path)
	local script = resolve(path)

	if not script:IsA("LuaSourceContainer") then
		error(pathOf(script) .. " is a " .. script.ClassName .. ", not a script")
	end

	return script
end

-- Returns the compile error for a source string, or nil when it compiles.
local function syntaxError(source)
	local fn, message = loadstring(source, "=validate")

	if fn then
		return nil
	end

	return tostring(message)
end
