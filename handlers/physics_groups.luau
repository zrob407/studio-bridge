local PhysicsService = game:GetService("PhysicsService")
local action = params.action

local function exists(name)
	for _, group in ipairs(PhysicsService:GetRegisteredCollisionGroups()) do
		if group.name == name then
			return true
		end
	end

	return false
end

local function requireGroup(name, label)
	if type(name) ~= "string" or name == "" then
		error(label .. " is required")
	end

	if not exists(name) then
		error("no collision group named " .. name)
	end
end

if action == "list" then
	local groups = PhysicsService:GetRegisteredCollisionGroups()

	table.sort(groups, function(a, b)
		return a.name < b.name
	end)

	local lines = {}

	for _, group in ipairs(groups) do
		local ignored = {}

		for _, other in ipairs(groups) do
			if not PhysicsService:CollisionGroupsAreCollidable(group.name, other.name) then
				table.insert(ignored, other.name)
			end
		end

		table.insert(lines, group.name .. (if #ignored > 0 then " does not collide with: " .. table.concat(ignored, ", ") else " collides with everything"))
	end

	return table.concat(lines, "\n")
elseif action == "register" then
	if type(params.name) ~= "string" or params.name == "" then
		error("name is required")
	end

	if exists(params.name) then
		return params.name .. " already exists"
	end

	PhysicsService:RegisterCollisionGroup(params.name)

	return "registered " .. params.name
elseif action == "unregister" then
	requireGroup(params.name, "name")
	PhysicsService:UnregisterCollisionGroup(params.name)

	return "removed " .. params.name
elseif action == "rename" then
	requireGroup(params.name, "name")

	if type(params.newName) ~= "string" or params.newName == "" then
		error("newName is required")
	end

	PhysicsService:RenameCollisionGroup(params.name, params.newName)

	return "renamed " .. params.name .. " to " .. params.newName
elseif action == "set_collidable" then
	requireGroup(params.a, "a")
	requireGroup(params.b, "b")

	if type(params.collidable) ~= "boolean" then
		error("collidable must be true or false")
	end

	PhysicsService:CollisionGroupSetCollidable(params.a, params.b, params.collidable)

	return string.format("%s and %s %s", params.a, params.b, if params.collidable then "now collide" else "no longer collide")
elseif action == "assign" then
	requireGroup(params.group, "group")

	local assigned = 0

	for _, path in ipairs(params.paths or {}) do
		local target = resolve(path)

		if target:IsA("BasePart") then
			target.CollisionGroup = params.group
			assigned += 1
		end

		if params.descendants ~= false then
			for _, descendant in ipairs(target:GetDescendants()) do
				if descendant:IsA("BasePart") then
					descendant.CollisionGroup = params.group
					assigned += 1
				end
			end
		end
	end

	return "put " .. assigned .. " part(s) in " .. params.group
elseif action == "members" then
	requireGroup(params.group, "group")

	local root = if params.root then resolve(params.root) else workspace
	local count = 0
	local samples = {}

	for _, descendant in ipairs(root:GetDescendants()) do
		if descendant:IsA("BasePart") and descendant.CollisionGroup == params.group then
			count += 1

			if #samples < (params.limit or 10) then
				table.insert(samples, pathOf(descendant))
			end
		end
	end

	return count .. " part(s) in " .. params.group .. (if #samples > 0 then "\n" .. table.concat(samples, "\n") else "")
end

error("action must be list, register, unregister, rename, set_collidable, assign or members")
