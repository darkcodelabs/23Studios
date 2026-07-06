-- newb_hero: Mario-64 style 1-bit teen hacker, 4 rows x 4 frames, 48x64
local W,H = 48,64
local spr = Sprite(W,H,ColorMode.INDEXED)
spr.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)
for _=2,16 do spr:newEmptyFrame() end

-- 4x4 Bayer matrix: the shading engine
local BAYER={{0,8,2,10},{12,4,14,6},{3,11,1,9},{15,7,13,5}}
local function bay(x,y) return (BAYER[(y%4)+1][(x%4)+1]+0.5)/16 end

local function newbuf()
  local b={}
  for y=0,H-1 do b[y]={} end
  return b
end
local function put(b,x,y,c)
  if x>=0 and x<W and y>=0 and y<H then b[y][x]=c end
end

-- shaded ball: key light upper-left, rim AO lower-right, specular blob
local function ball(b,cx,cy,rx,ry,dk)
  dk=dk or 0
  for y=math.floor(cy-ry),math.ceil(cy+ry) do
    for x=math.floor(cx-rx),math.ceil(cx+rx) do
      local nx,ny=(x-cx)/rx,(y-cy)/ry
      local d=nx*nx+ny*ny
      if d<=1 then
        local br=1.18-0.9*((nx*0.62+ny*0.78)*0.5+0.5)-dk
        if d>0.74 and (nx*0.6+ny*0.8)>0.1 then br=br-0.35 end
        if nx<-0.15 and ny<-0.3 and d<0.4 then br=1.2 end
        put(b,x,y,(br>bay(x,y)) and 2 or 1)
      end
    end
  end
end

local function disc(b,cx,cy,rx,ry,c)
  for y=math.floor(cy-ry),math.ceil(cy+ry) do
    for x=math.floor(cx-rx),math.ceil(cx+rx) do
      local nx,ny=(x-cx)/rx,(y-cy)/ry
      if nx*nx+ny*ny<=1 then put(b,x,y,c) end
    end
  end
end

local function rect(b,x0,y0,w,h,c)
  for y=y0,y0+h-1 do for x=x0,x0+w-1 do put(b,x,y,c) end end
end

-- blacken filled pixels touching empty space (inner stroke)
local function edgeInk(b)
  local m={}
  for y=0,H-1 do for x=0,W-1 do
    if b[y][x] then
      local open=false
      for dy=-1,1 do for dx=-1,1 do
        local xx,yy=x+dx,y+dy
        if xx<0 or xx>=W or yy<0 or yy>=H or not b[yy][xx] then open=true end
      end end
      if open then m[#m+1]={x,y} end
    end
  end end
  for _,p in ipairs(m) do b[p[2]][p[1]]=1 end
end

-- dilate silhouette outward with black (outer stroke)
local function grow(b,n)
  for _=1,n do
    local m={}
    for y=0,H-1 do for x=0,W-1 do
      if not b[y][x] then
        local near=false
        for dy=-1,1 do for dx=-1,1 do
          local xx,yy=x+dx,y+dy
          if xx>=0 and xx<W and yy>=0 and yy<H and b[yy][xx] then near=true end
        end end
        if near then m[#m+1]={x,y} end
      end
    end end
    for _,p in ipairs(m) do b[p[2]][p[1]]=1 end
  end
end

local function sneakerFront(b,fx,fy,rx,ry)
  ball(b,fx,fy,rx,ry,0)
  rect(b,fx-rx+2,fy+1,rx*2-4,1,1)  -- sole line
  put(b,fx,fy-2,1)                 -- lace dot
end

local function sneakerSide(b,fx,fy,dxs)
  ball(b,fx,fy,6,3.5,0)
  ball(b,fx+dxs*4,fy+1,3.5,2.5,0)  -- fat toe cap
  rect(b,fx-5,fy+1,11,1,1)         -- sole line
  put(b,fx+1,fy-2,1)               -- lace dot
end

-- dir: 1 front, 2 back, 3 left, 4 right; f: 0..3
local function compose(dir,f)
  local b=newbuf()
  local cx=24
  local pass=(f%2==1)
  local bob=pass and -2 or 0           -- 2px head/body bob
  local sq=pass and 0 or 1             -- squash on contact, stretch on pass
  local s=(f==0 and 1) or (f==2 and -1) or 0
  local hy=15+bob                      -- head center
  local by=36+bob                      -- body center

  if dir==1 or dir==2 then
    -- ===== legs + sneakers =====
    if s~=0 then
      local fwdx=cx-8*s
      local bakx=cx+6*s
      rect(b,bakx-2,42,4,12,2)
      sneakerFront(b,bakx,54,5,3)              -- lifted back foot
      rect(b,fwdx-2,42,4,15,2)
      sneakerFront(b,fwdx,57,6,3.5)            -- planted forward foot
    else
      rect(b,cx-8,42,4,15,2)
      rect(b,cx+4,42,4,15,2)
      sneakerFront(b,cx-6,57,5.5,3)
      sneakerFront(b,cx+6,57,5.5,3)
    end
    -- ===== neck + puffy hoodie body =====
    rect(b,cx-4,hy+7,9,7,2)
    ball(b,cx,by,10+sq,10-sq,0)
    if dir==2 then
      ball(b,cx,by-5,7,4,0.35)                 -- hood bump, dark dither
    else
      -- collar arc
      for i=-5,5 do
        put(b,cx+i,by-9+math.floor(i*i/12),1)
        put(b,cx+i,by-8+math.floor(i*i/12),1)
      end
      rect(b,cx-3,by-6,1,4,1)                  -- drawstrings
      rect(b,cx+2,by-6,1,4,1)
      rect(b,cx-6,by+4,12,1,1)                 -- kangaroo pocket
      rect(b,cx-6,by+4,1,4,1)
      rect(b,cx+5,by+4,1,4,1)
    end
    -- ===== swinging arms + mitt hands =====
    local sw=3*s
    ball(b,cx-12,by-1-sw,3.5,6,0.1)
    ball(b,cx+12,by-1+sw,3.5,6,0.1)
    ball(b,cx-12,by+4-sw,3,3,-0.2)
    ball(b,cx+12,by+4+sw,3,3,-0.2)
    -- ===== big round head =====
    ball(b,cx,hy,11,10,0)
    if dir==1 then
      ball(b,cx,hy-4,11,6.5,0.22)              -- cap dome, darker ramp
      rect(b,cx-10,hy-3,21,2,1)                -- cap band
      for yy=hy-6,hy-5 do for xx=cx-2,cx+2 do  -- strap gap (hair peek)
        if (xx+yy)%2==0 then put(b,xx,yy,1) end
      end end
      disc(b,cx,hy+3,8,5,2)                    -- bold white face
      rect(b,cx-5,hy+1,2,2,1)                  -- dot eyes
      rect(b,cx+3,hy+1,2,2,1)
      rect(b,cx-1,hy+6,3,1,1)                  -- mouth
    else
      ball(b,cx,hy-2,11,8.5,0.22)              -- cap covers back of head
      rect(b,cx-1,hy-8,2,2,1)                  -- cap button
      rect(b,cx-9,hy+2,19,1,1)                 -- band, back
      disc(b,cx,hy+6,9.5,3.2,1)                -- backwards bill, outlined
      ball(b,cx,hy+6,8,2.2,0.12)
    end
  else
    local dxs=(dir==3) and -1 or 1
    local hx=cx+dxs*1
    -- ===== scissoring legs =====
    local fxA,fyA,fxB,fyB
    if s~=0 then
      fxA=cx+dxs*8*s; fyA=57                   -- big stride apart
      fxB=cx-dxs*8*s; fyB=56
    else
      local liftA=(f==1)
      fxA=cx+dxs*2; fyA=liftA and 53 or 57     -- pass pose, one foot up
      fxB=cx-dxs*2; fyB=liftA and 57 or 53
    end
    rect(b,fxB-2,42,4,fyB-42,2)
    sneakerSide(b,fxB,fyB,dxs)
    rect(b,fxA-2,42,4,fyA-42,2)
    sneakerSide(b,fxA,fyA,dxs)
    -- ===== far arm (behind), body, near arm =====
    ball(b,cx+dxs*6*s,by-1,3.5,6,0.3)
    rect(b,cx-4,hy+7,9,7,2)
    ball(b,cx,by,10+sq,10-sq,0)
    rect(b,cx-2+dxs*3,by+5,4,1,1)              -- pocket hint
    local nax=cx-dxs*6*s
    ball(b,nax,by-1,3.5,6,0)
    ball(b,nax,by+4,3,3,-0.2)
    -- ===== head profile, bill sticks backward =====
    disc(b,hx-dxs*12,hy-3,6,2.8,1)             -- bill outline
    ball(b,hx-dxs*12,hy-3,4.5,1.8,0.15)
    ball(b,hx,hy,11,10,0)
    ball(b,hx,hy-4,10.5,6.5,0.22)              -- cap dome
    rect(b,hx-10,hy-3,21,2,1)                  -- band
    disc(b,hx+dxs*4,hy+3,6,5,2)                -- bold white face
    ball(b,hx+dxs*10,hy+3,2.5,2,0)             -- nose bump
    rect(b,hx+dxs*6-1,hy+1,2,2,1)              -- eye
    rect(b,hx+dxs*8-1,hy+6,2,1,1)              -- mouth
  end
  return b
end

local function render(img,dir,f)
  local b=compose(dir,f)
  edgeInk(b)      -- 1px inner stroke on silhouette
  grow(b,2)       -- +2px outer stroke => 3px contour
  -- checkerboard blob shadow, wider on contact frames
  local wide=(f%2==0) and 2 or 0
  local srx=11+wide
  for y=59,62 do
    for x=24-srx,24+srx do
      local nx,ny=(x-24)/srx,(y-60.5)/1.8
      if nx*nx+ny*ny<=1 and (x+y)%2==0 and x>=0 and x<W and not b[y][x] then
        img:putPixel(x,y,1)
      end
    end
  end
  for y=0,H-1 do for x=0,W-1 do
    if b[y][x] then img:putPixel(x,y,b[y][x]) end
  end end
end

local function imageFor(fr)
  for _,c in ipairs(spr.cels) do
    if c.frameNumber==fr then return c.image end
  end
  return spr:newCel(spr.layers[1],fr).image
end

for row=0,3 do
  for f=0,3 do
    render(imageFor(row*4+f+1),row+1,f)
  end
end

local names={"walk_down","walk_up","walk_left","walk_right"}
for i=0,3 do
  local t=spr:newTag(i*4+1,i*4+4)
  t.name=names[i+1]
end

local out=os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out,"newb_hero.aseprite"))
app.command.ExportSpriteSheet{
  ui=false, askOverwrite=false,
  type=SpriteSheetType.ROWS, columns=4,
  textureFilename=app.fs.joinPath(out,"newb_hero-table-48-64.png"),
  dataFilename=""
}
print("ASE_GEN_OK")