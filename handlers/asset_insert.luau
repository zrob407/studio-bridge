local assetId = tonumber(string.match(tostring(params.assetId or ""), "%d+"))

if not assetId then
	error("assetId is required")
end

local parent = if params.parent then resolve(params.parent) else workspace
local keepScripts = params.keepScripts == true

local loaded, children = pcall(function()
	return game:GetObjects("rbxassetid://" .. assetId)
end)

if not loaded then
	error("could not load asset " .. assetId .. ": " .. tostring(children))
end

local staging = Instance.new("Folder")
staging.Name = "__AssetStaging"
staging.Parent = game:GetService("ServerStorage")

for _, child in ipairs(children) do
	child.Parent = staging
end

if #children == 0 then
	staging:Destroy()

	return "asset " .. assetId .. " loaded but is empty"
end

local report = scanScripts(staging, params.max_findings or 60)
local names = {}

for _, child in ipairs(children) do
	table.insert(names, child.Name .. " (" .. child.ClassName .. ")")
end

local scripts = {}

for _, descendant in ipairs(staging:GetDescendants()) do
	if descendant:IsA("LuaSourceContainer") then
		table.insert(scripts, descendant)
	end
end

if keepScripts and params.block_high ~= false and string.find(report, "%d+ high") and not string.find(report, " 0 high,") then
	staging:Destroy()

	return string.format("NOT inserted (high-risk code found; rerun with block_high false to force). Asset %d: %s\n%s", assetId, table.concat(names, ", "), report)
end

local removed = 0

if not keepScripts then
	for _, script in ipairs(scripts) do
		if script.Parent then
			script:Destroy()
			removed += 1
		end
	end
end

local placeAt = if params.position then toVector3(params.position, "position") else nil

for _, child in ipairs(children) do
	if child.Parent then
		child.Parent = parent

		if placeAt then
			if child:IsA("Model") then
				child:PivotTo(CFrame.new(placeAt))
			elseif child:IsA("BasePart") then
				child.Position = placeAt
			end
		end
	end
end

staging:Destroy()

return string.format(
	"inserted asset %d into %s: %s%s\n%s",
	assetId,
	pathOf(parent),
	table.concat(names, ", "),
	if removed > 0 then string.format("\nremoved %d script(s) (pass keepScripts true to keep them)", removed) else "",
	report
)
