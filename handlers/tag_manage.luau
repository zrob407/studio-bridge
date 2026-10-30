local action = params.action

local function targets()
	local paths = params.paths or (if params.path then {params.path} else {})

	if #paths == 0 then
		error("path or paths is required")
	end

	local found = {}

	for _, path in ipairs(paths) do
		table.insert(found, resolve(path))
	end

	return found
end

local function tagList()
	local tags = params.tags or (if params.tag then {params.tag} else {})

	if #tags == 0 then
		error("tag or tags is required")
	end

	return tags
end

if action == "list" then
	local rows = {}

	for _, tag in ipairs(CollectionService:GetAllTags()) do
		table.insert(rows, {tag = tag, count = #CollectionService:GetTagged(tag)})
	end

	table.sort(rows, function(a, b)
		if a.count ~= b.count then
			return a.count > b.count
		end

		return a.tag < b.tag
	end)

	if #rows == 0 then
		return "no tags in use"
	end

	local lines = {}

	for _, row in ipairs(rows) do
		table.insert(lines, row.tag .. " " .. row.count)
	end

	return table.concat(lines, "\n")
elseif action == "find" then
	local limit = params.limit or 200
	local lines = {}
	local total = 0

	for _, tag in ipairs(tagList()) do
		for _, instance in ipairs(CollectionService:GetTagged(tag)) do
			total += 1

			if #lines < limit then
				table.insert(lines, pathOf(instance) .. " [" .. tag .. "]")
			end
		end
	end

	if total == 0 then
		return "nothing has these tags"
	end

	if total > #lines then
		table.insert(lines, (total - #lines) .. " more not shown")
	end

	return table.concat(lines, "\n")
elseif action == "get" then
	local lines = {}

	for _, instance in ipairs(targets()) do
		local tags = CollectionService:GetTags(instance)
		table.sort(tags)
		table.insert(lines, pathOf(instance) .. ": " .. (if #tags > 0 then table.concat(tags, ", ") else "(none)"))
	end

	return table.concat(lines, "\n")
elseif action == "add" or action == "remove" then
	local changed = 0
	local tags = tagList()

	for _, instance in ipairs(targets()) do
		for _, tag in ipairs(tags) do
			if action == "add" and not CollectionService:HasTag(instance, tag) then
				CollectionService:AddTag(instance, tag)
				changed += 1
			elseif action == "remove" and CollectionService:HasTag(instance, tag) then
				CollectionService:RemoveTag(instance, tag)
				changed += 1
			end
		end
	end

	return (if action == "add" then "added " else "removed ") .. changed .. " tag assignment(s)"
end

error("action must be list, find, get, add or remove")
