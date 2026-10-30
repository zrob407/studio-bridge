local source = resolve(params.path)
local parent = if params.parent then resolve(params.parent) else source.Parent
local mode = params.mode or "array"
local MAX_COPIES = 2000

local function frameOf(instance)
	if instance:IsA("Model") then
		return instance:GetPivot()
	elseif instance:IsA("BasePart") then
		return instance.CFrame
	end

	error(pathOf(instance) .. " is not a Model or a BasePart")
end

local function place(instance, frame)
	if instance:IsA("Model") then
		instance:PivotTo(frame)
	else
		instance.CFrame = frame
	end
end

local base = frameOf(source)
local frames = {}

if mode == "array" then
	local count = params.count or 1
	local offset = toVector3(params.offset, "offset")
	local turn = if params.rotation then toVector3(params.rotation, "rotation") else Vector3.zero

	for index = 1, count do
		local spin = CFrame.Angles(math.rad(turn.X * index), math.rad(turn.Y * index), math.rad(turn.Z * index))

		table.insert(frames, (base * spin) + offset * index)
	end
elseif mode == "grid" then
	local counts = toVector3(params.counts, "counts")
	local spacing = toVector3(params.spacing, "spacing")

	for x = 0, counts.X - 1 do
		for y = 0, counts.Y - 1 do
			for z = 0, counts.Z - 1 do
				if x ~= 0 or y ~= 0 or z ~= 0 then
					table.insert(frames, base + Vector3.new(x * spacing.X, y * spacing.Y, z * spacing.Z))
				end
			end
		end
	end
elseif mode == "radial" then
	local count = params.count or 8
	local radius = params.radius or 10
	local middle = if params.center then toVector3(params.center, "center") else base.Position
	local facing = params.faceCenter == true

	for index = 0, count - 1 do
		local angle = index / count * math.pi * 2
		local position = middle + Vector3.new(math.cos(angle) * radius, 0, math.sin(angle) * radius)
		local frame = CFrame.new(position) * (base - base.Position)

		if facing then
			frame = CFrame.lookAt(position, Vector3.new(middle.X, position.Y, middle.Z))
		end

		table.insert(frames, frame)
	end
else
	error("mode must be array, grid or radial")
end

if #frames == 0 then
	error("that would make no copies")
end

if #frames > MAX_COPIES then
	error("that would make " .. #frames .. " copies (limit " .. MAX_COPIES .. ")")
end

local pattern = params.namePattern or "{name} {n}"
local created = {}

for index, frame in ipairs(frames) do
	local copy = source:Clone()

	if not copy then
		error(pathOf(source) .. " cannot be cloned")
	end

	copy.Name = string.gsub(string.gsub(pattern, "{name}", source.Name), "{n}", tostring(index))
	copy.Parent = parent
	place(copy, frame)
	table.insert(created, pathOf(copy))
end

local lines = {"made " .. #created .. " copies in " .. pathOf(parent)}

for index = 1, math.min(#created, 8) do
	table.insert(lines, created[index])
end

if #created > 8 then
	table.insert(lines, (#created - 8) .. " more")
end

return table.concat(lines, "\n")
