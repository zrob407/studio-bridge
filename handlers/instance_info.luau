local mode = params.mode

if mode == "ancestors" then
	local target = resolve(params.path)
	local lines = {}
	local current = target

	while current and current ~= game do
		table.insert(lines, 1, current.Name .. " [" .. current.ClassName .. "]")
		current = current.Parent
	end

	return "game > " .. table.concat(lines, " > ")
elseif mode == "tree" then
	local target = if params.path then resolve(params.path) else game
	local maxDepth = params.depth or 2
	local limit = params.limit or 120
	local lines = {}
	local shown = 0
	local total = 0

	local function walk(instance, depth)
		for _, child in ipairs(instance:GetChildren()) do
			total += 1

			if shown < limit then
				shown += 1

				local count = #child:GetChildren()

				table.insert(lines, string.rep("  ", depth) .. child.Name .. " [" .. child.ClassName .. "]" .. (if count > 0 and depth + 1 >= maxDepth then " (" .. count .. " children)" else ""))
			end

			if depth + 1 < maxDepth then
				walk(child, depth + 1)
			end
		end
	end

	table.insert(lines, pathOf(target) .. " [" .. target.ClassName .. "]")
	walk(target, 1)

	if total > shown then
		table.insert(lines, (total - shown) .. " more entries not shown (raise limit or narrow the path)")
	end

	return table.concat(lines, "\n")
elseif mode == "class_info" then
	if type(params.class) ~= "string" then
		error("class is required")
	end

	local reflection = game:GetService("ReflectionService")
	local lines = {}

	local function list(label, method)
		local ok, entries = pcall(function()
			return reflection[method](reflection, params.class, {})
		end)

		if not ok or not entries then
			return
		end

		local names = {}

		for _, entry in ipairs(entries) do
			if not string.find(entry.Name, "^[a-z]") then
				table.insert(names, entry.Name)
			end
		end

		table.sort(names)

		if #names > 0 then
			table.insert(lines, label .. " (" .. #names .. "): " .. table.concat(names, ", "))
		end
	end

	local chain = {}
	local current = params.class

	while current do
		local ok, class = pcall(function()
			return reflection:GetClass(current)
		end)

		if not ok or not class then
			break
		end

		table.insert(chain, class.Name)
		current = class.Superclass
	end

	if #chain == 0 then
		error("no class named " .. params.class)
	end

	table.insert(lines, table.concat(chain, " > ") .. " (members include inherited ones)")
	list("properties", "GetPropertiesOfClass")
	list("methods", "GetMethodsOfClass")
	list("events", "GetEventsOfClass")

	return table.concat(lines, "\n")
end

error("mode must be ancestors, tree or class_info")
