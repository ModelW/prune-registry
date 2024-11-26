#!/bin/bash

set -e

# Registry details
REGISTRY="localhost:5000"
USERNAME="u"
PASSWORD="p"

# Login to the registry
echo "Logging in to registry..."
echo "$PASSWORD" | docker login $REGISTRY -u "$USERNAME" --password-stdin

# Function to create and push an image
create_and_push_image() {
    local content=$1
    local tag1=$2
    local tag2=$3

    # Create a temporary directory
    temp_dir=$(mktemp -d)

    # Create the hello.txt file with the specified content
    echo "$content" > "$temp_dir/hello.txt"

    # Create a Dockerfile
    cat << 'EOF' > "$temp_dir/Dockerfile"
FROM scratch
COPY hello.txt /hello.txt
CMD ["/bin/sh", "-c", "cat /hello.txt"]
EOF

    # Build the image
    docker build -t "$REGISTRY/test-image:$tag1" "$temp_dir"

    # Tag the image with the second tag
    docker tag "$REGISTRY/test-image:$tag1" "$REGISTRY/test-image:$tag2"

    # Push both tags
    docker push "$REGISTRY/test-image:$tag1"
    docker push "$REGISTRY/test-image:$tag2"

    # Clean up
    rm -rf "$temp_dir"
}

# Create and push the first image
echo "Creating and pushing first image..."
create_and_push_image "aaa" "develop" "aaa"

# Create and push the second image
echo "Creating and pushing second image..."
create_and_push_image "bbb" "develop" "bbb"

echo "Script completed successfully!"
