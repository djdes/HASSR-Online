set -e
mkdir -p /tmp/places && cd /tmp/places
dl() { curl -sL --max-time 120 "https://wsrv.nl/?url=images.unsplash.com%2F$2%3Fw%3D1600%26q%3D70&output=webp&w=1400&q=70" -o "$1.webp" && echo "$1 $(stat -c%s "$1.webp")"; }
dl fridge photo-1782750161991-23529c9462bb
dl locker photo-1637028251652-cdef2b2b6100
dl uv     photo-1706851548689-60ba957119d2
dl fryer  photo-1575047496698-fe888afdad1e
dl forgot photo-1644329968124-4c68f17c21e3
dl sensor photo-1601599561213-832382fd07ba
file *.webp
