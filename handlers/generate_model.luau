local GenerationService = game:GetService("GenerationService")

if type(params.prompt) ~= "string" or params.prompt == "" then
	error("prompt is required")
end

local inputs = {TextPrompt = params.prompt, GenerateTextures = params.textures ~= false}

if params.size then
	inputs.Size = toVector3(params.size, "size")
end

if params.maxTriangles then
	inputs.MaxTriangles = params.maxTriangles
end

if params.imageAssetId then
	local id = tonumber(string.match(tostring(params.imageAssetId), "%d+"))

	if not id then
		error("imageAssetId is not an asset id")
	end

	inputs.Image = Content.fromAssetId(id)
end

local schema

if params.groups then
	if type(params.groups) ~= "table" or #params.groups == 0 then
		error("groups must be a list of part names")
	end

	schema = {SchemaDefinition = {Groups = params.groups}}
else
	local predefined = params.schema or "Body1"

	if predefined ~= "Body1" and predefined ~= "Car5" then
		error("schema must be Body1 (one mesh) or Car5 (a vehicle chassis), or give groups")
	end

	schema = {PredefinedSchema = predefined}
end

local parent = if params.parent then resolve(params.parent) else workspace
local ok, model, metadata = pcall(function()
	return GenerationService:GenerateModelAsync(inputs, schema)
end)

if not ok then
	error("generation failed: " .. tostring(model))
end

if typeof(model) ~= "Instance" then
	error("generation returned no model")
end

model.Name = params.name or string.sub(params.prompt, 1, 40)
model.Parent = parent

if params.position then
	local position = toVector3(params.position, "position")

	if model:IsA("Model") then
		model:PivotTo(CFrame.new(position))
	elseif model:IsA("BasePart") then
		model.Position = position
	end
end

local parts = 0

for _, descendant in ipairs(model:GetDescendants()) do
	if descendant:IsA("BasePart") then
		parts += 1
	end
end

local id = if type(metadata) == "table" then metadata.UUID or metadata.Uuid or metadata.uuid else nil

return string.format("generated %s in %s with %d part(s)%s", pathOf(model), pathOf(parent), parts, if id then ", id " .. tostring(id) else "")
