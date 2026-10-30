local mode = params.mode
local root = if params.root then resolve(params.root) else game

local function scriptsUnder(container)
	local found = {}

	if container:IsA("LuaSourceContainer") then
		table.insert(found, container)
	end

	for _, descendant in ipairs(container:GetDescendants()) do
		if descendant:IsA("LuaSourceContainer") then
			table.insert(found, descendant)
		end
	end

	return found
end

local function argumentsOf(source)
	local found = {}
	local position = 1

	while true do
		local start, finish = string.find(source, "require%s*%(", position)

		if not start then
			break
		end

		local depth = 1
		local index = finish + 1

		while index <= #source and depth > 0 do
			local char = string.sub(source, index, index)

			if char == "(" then
				depth += 1
			elseif char == ")" then
				depth -= 1
			end

			index += 1
		end

		table.insert(found, (string.gsub(string.sub(source, finish + 1, index - 2), "^%s+", "")))
		position = index
	end

	return found
end

local function evaluate(expression, origin)
	local text = (string.gsub((string.gsub(expression, "%s+$", "")), "%s*%.%s*", "."))
	local current

	if string.sub(text, 1, 6) == "script" then
		current = origin
		text = string.sub(text, 7)
	elseif string.sub(text, 1, 4) == "game" then
		current = game
		text = string.sub(text, 5)
	else
		return nil
	end

	while #text > 0 do
		local name = string.match(text, "^%.Parent")

		if name and not string.match(text, "^%.Parent[%w_]") then
			current = current.Parent
			text = string.sub(text, 8)
		elseif string.match(text, "^:GetService%(%s*[\"'](%w+)[\"']%s*%)") then
			local service, rest = string.match(text, "^:GetService%(%s*[\"'](%w+)[\"']%s*%)(.*)$")

			current = game:GetService(service)
			text = rest
		elseif string.match(text, "^:[WF][%a]*Child%(%s*[\"']([^\"']+)[\"']") then
			local child, rest = string.match(text, "^:[WF][%a]*Child%(%s*[\"']([^\"']+)[\"'][^%)]*%)(.*)$")

			current = current and current:FindFirstChild(child)
			text = rest or ""
		elseif string.match(text, "^%.([%a_][%w_]*)") then
			local child = string.match(text, "^%.([%a_][%w_]*)")

			current = current and current:FindFirstChild(child)
			text = string.sub(text, #child + 2)
		elseif string.match(text, "^%[%s*[\"']([^\"']+)[\"']%s*%]") then
			local child, rest = string.match(text, "^%[%s*[\"']([^\"']+)[\"']%s*%](.*)$")

			current = current and current:FindFirstChild(child)
			text = rest
		else
			return nil
		end

		if not current then
			return nil
		end
	end

	return current
end

local edges = {}
local unresolved = {}
local assetRequires = {}

for _, script in ipairs(scriptsUnder(root)) do
	for _, argument in ipairs(argumentsOf(readSource(script))) do
		if string.match(argument, "^%d+$") then
			table.insert(assetRequires, {script = script, id = argument})
		else
			local ok, target = pcall(evaluate, argument, script)

			if ok and target and typeof(target) == "Instance" then
				table.insert(edges, {from = script, to = target})
			else
				table.insert(unresolved, {script = script, text = argument})
			end
		end
	end
end

local limit = params.limit or 30

local function cap(lines)
	if #lines > limit then
		local shown = {}

		for index = 1, limit do
			table.insert(shown, lines[index])
		end

		table.insert(shown, (#lines - limit) .. " more not shown")

		return table.concat(shown, "\n")
	end

	return table.concat(lines, "\n")
end

if mode == "deps" then
	local target = resolve(params.path)
	local lines = {}

	for _, edge in ipairs(edges) do
		if edge.from == target then
			table.insert(lines, "requires " .. pathOf(edge.to))
		end
	end

	for _, entry in ipairs(assetRequires) do
		if entry.script == target then
			table.insert(lines, "requires asset id " .. entry.id .. " (code loaded from Roblox at runtime)")
		end
	end

	for _, entry in ipairs(unresolved) do
		if entry.script == target then
			table.insert(lines, "could not resolve: " .. entry.text)
		end
	end

	if #lines == 0 then
		return pathOf(target) .. " requires nothing"
	end

	return pathOf(target) .. ":\n" .. cap(lines)
elseif mode == "dependents" then
	local target = resolve(params.path)
	local lines = {}

	for _, edge in ipairs(edges) do
		if edge.to == target then
			table.insert(lines, pathOf(edge.from))
		end
	end

	if #lines == 0 then
		return "nothing under " .. pathOf(root) .. " requires " .. pathOf(target)
	end

	return #lines .. " script(s) require " .. pathOf(target) .. ":\n" .. cap(lines)
elseif mode == "unused" then
	local required = {}

	for _, edge in ipairs(edges) do
		required[edge.to] = true
	end

	local lines = {}

	for _, script in ipairs(scriptsUnder(root)) do
		if script:IsA("ModuleScript") and not required[script] then
			table.insert(lines, pathOf(script))
		end
	end

	if #lines == 0 then
		return "every ModuleScript is required by something"
	end

	return #lines .. " ModuleScript(s) nothing requires (they may still be required by a path this tool cannot resolve; " .. #unresolved .. " require call(s) were unresolved):\n" .. cap(lines)
elseif mode == "assets" then
	if #assetRequires == 0 then
		return "no require(assetId) calls under " .. pathOf(root)
	end

	local lines = {}

	for _, entry in ipairs(assetRequires) do
		table.insert(lines, pathOf(entry.script) .. " requires asset id " .. entry.id)
	end

	return #lines .. " require(assetId) call(s); this loads code from Roblox at runtime:\n" .. cap(lines)
end

error("mode must be deps, dependents, unused or assets")
